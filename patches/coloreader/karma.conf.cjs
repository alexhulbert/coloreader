'use strict';

module.exports = async (config) => {
    const {configureKarma} = await import('../tests/inject/karma.conf.js');
    const options = configureKarma(config, process.env);
    options.basePath = '..';
    options.files = [
        'tests/inject/support/customize.ts',
        'tests/inject/support/polyfills.ts',
        {pattern: 'tests/coloreader.tests.ts', watched: false},
    ];
    options.rollupPreprocessor.plugins[0] = require('@rollup/plugin-typescript')({
        rootDir: require('node:path').resolve(__dirname, '..'),
        outDir: 'build/tests',
        tsconfig: require('node:path').join(__dirname, 'tsconfig.json'),
    });
    config.set(options);
};
