// Hook Node startup once, restore it, then run the Electron bootstrap.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
#include "payload.h"

#if !defined(__linux__) || !defined(__x86_64__)
#error "The injector currently supports Linux x86-64 only"
#endif

#define PATCH_SIZE 12

typedef void *(*load_fn)(void *, void *, void *);
// Some Electron builds export both startup overloads.
static const char *const names[2] = {
    "_ZN4node15LoadEnvironmentEPNS_11EnvironmentENSt4__Cr8functionIFN2v810MaybeLocalINS4_5ValueEEERKNS_26StartExecutionCallbackInfoEEEENS3_IFvS1_NS4_5LocalIS6_EESE_EEE",
    "_ZN4node15LoadEnvironmentEPNS_11EnvironmentENSt4__Cr8functionIFN2v810MaybeLocalINS4_5ValueEEERKNS_36StartExecutionCallbackInfoWithModuleEEEENS3_IFvS1_NS4_5LocalIS6_EESE_EEE",
};
static struct { void *address; unsigned char original[PATCH_SIZE]; } sites[2];
static void *(*current_isolate)(void);
static void *(*main_context)(void *);
static void (*enter_context)(void *);
static void (*exit_context)(void *);
static void *(*new_string)(void *, const char *, int, int);
static void *(*compile_script)(void *, void *, void *);
static void *(*run_script)(void *, void *);

static int protect(int permission) {
    size_t page = (size_t)sysconf(_SC_PAGESIZE);
    for (int i = 0; i < 2; i++) {
        if (!sites[i].address) continue;
        uintptr_t begin = (uintptr_t)sites[i].address & ~(page - 1);
        uintptr_t end = ((uintptr_t)sites[i].address + PATCH_SIZE + page - 1) & ~(page - 1);
        if (mprotect((void *)begin, end - begin, permission)) return -1;
    }
    return 0;
}

static void *invoke(int index, void *env, void *entry, void *preload) {
    if (protect(PROT_READ | PROT_WRITE | PROT_EXEC)) {
        // We can't call the original while the jump is still installed.
        fputs("[coloreader] cannot restore native startup\n", stderr);
        _exit(86);
    }
    for (int i = 0; i < 2; i++) if (sites[i].address) memcpy(sites[i].address, sites[i].original, PATCH_SIZE);
    protect(PROT_READ | PROT_EXEC);
    void *result = ((load_fn)sites[index].address)(env, entry, preload);
    void *isolate = current_isolate();
    void *context = isolate ? main_context(env) : NULL;
    if (!context) return result;
    enter_context(context);
    void *text = new_string(isolate, coloreader_payload, 0, -1);
    void *script = text ? compile_script(context, text, NULL) : NULL;
    if (script) run_script(script, context);
    exit_context(context);
    return result;
}

static void *first(void *env, void *entry, void *preload) { return invoke(0, env, entry, preload); }
static void *second(void *env, void *entry, void *preload) { return invoke(1, env, entry, preload); }

static int eligible(void) {
    const char *disabled = getenv("COLOREADER_DISABLE");
    if ((disabled && !strcmp(disabled, "1")) || getenv("ELECTRON_RUN_AS_NODE")) return 0;
    for (int i = 0; i < 2; i++) sites[i].address = dlsym(RTLD_DEFAULT, names[i]);
    if (!sites[0].address && !sites[1].address) return 0;
    // Skip renderer, GPU and utility processes.
    FILE *cmdline = fopen("/proc/self/cmdline", "rb");
    if (!cmdline) return 0;
    char args[16384];
    size_t count = fread(args, 1, sizeof(args) - 1, cmdline);
    int complete = feof(cmdline);
    fclose(cmdline);
    if (!complete) return 0;
    args[count] = 0;
    for (size_t i = 0; i < count; i += strlen(args + i) + 1) if (!strncmp(args + i, "--type=", 7)) return 0;
    current_isolate = dlsym(RTLD_DEFAULT, "_ZN2v87Isolate10GetCurrentEv");
    main_context = dlsym(RTLD_DEFAULT, "_ZN4node14GetMainContextEPNS_11EnvironmentE");
    enter_context = dlsym(RTLD_DEFAULT, "_ZN2v87Context5EnterEv");
    exit_context = dlsym(RTLD_DEFAULT, "_ZN2v87Context4ExitEv");
    new_string = dlsym(RTLD_DEFAULT, "_ZN2v86String11NewFromUtf8EPNS_7IsolateEPKcNS_13NewStringTypeEi");
    compile_script = dlsym(RTLD_DEFAULT, "_ZN2v86Script7CompileENS_5LocalINS_7ContextEEENS1_INS_6StringEEEPNS_12ScriptOriginE");
    run_script = dlsym(RTLD_DEFAULT, "_ZN2v86Script3RunENS_5LocalINS_7ContextEEE");
    return current_isolate && main_context && enter_context && exit_context && new_string && compile_script && run_script;
}

static void stop_inheriting(void) {
    const char *preload = getenv("LD_PRELOAD");
    Dl_info library;
    if (!preload || !dladdr((void *)stop_inheriting, &library)) return;
    char *tokens = strdup(preload);
    char *remaining = calloc(strlen(preload) + 1, 1);
    if (!tokens || !remaining) { free(tokens); free(remaining); return; }
    char *next;
    for (char *token = strtok_r(tokens, ": ", &next); token; token = strtok_r(NULL, ": ", &next)) {
        if (!strcmp(token, library.dli_fname)) continue;
        if (*remaining) strcat(remaining, ":");
        strcat(remaining, token);
    }
    if (*remaining) setenv("LD_PRELOAD", remaining, 1);
    else unsetenv("LD_PRELOAD");
    free(tokens);
    free(remaining);
}

__attribute__((constructor)) static void initialize(void) {
    if (!eligible()) return;
    stop_inheriting();
    if (protect(PROT_READ | PROT_WRITE | PROT_EXEC)) return;
    load_fn hooks[2] = {first, second};
    for (int i = 0; i < 2; i++) if (sites[i].address) {
        memcpy(sites[i].original, sites[i].address, PATCH_SIZE);
        unsigned char jump[PATCH_SIZE] = {0x48, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xe0}; // mov rax, imm64; jmp rax
        uintptr_t target = (uintptr_t)hooks[i];
        memcpy(jump + 2, &target, sizeof(target));
        memcpy(sites[i].address, jump, PATCH_SIZE);
    }
    protect(PROT_READ | PROT_EXEC);
}
