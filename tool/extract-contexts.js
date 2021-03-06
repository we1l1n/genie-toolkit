// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const seedrandom = require('seedrandom');
const fs = require('fs');
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');

const { DatasetParser } = require('../lib/dataset-parsers');
const ContextExtractor = require('../lib/context-extractor');
const { AVAILABLE_LANGUAGES } = require('../lib/languages');
const StreamUtils = require('../lib/stream-utils');

const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('extract-contexts', {
            addHelp: true,
            description: "Extract normalized contexts from a non-contextual dataset."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
        });
        parser.addArgument(['-t', '--target-language'], {
            required: false,
            defaultValue: 'thingtalk',
            choices: AVAILABLE_LANGUAGES,
            help: `The programming language to generate`
        });
        parser.addArgument('--thingpedia', {
            required: false,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--contextual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'The passed in dataset is also contextual.',
            defaultValue: false
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to extract contexts from (in TSV format); use - for standard input'
        });

        parser.addArgument('--debug', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable debugging.',
            defaultValue: true
        });
        parser.addArgument('--no-debug', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'debug',
            help: 'Disable debugging.',
        });
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
        });
    },

    async execute(args) {
        const rng = seedrandom.alea(args.random_seed);
        let schemas = null;
        if (args.thingpedia) {
            const tpClient = new Tp.FileClient(args);
            schemas = new ThingTalk.SchemaRetriever(tpClient, null, !args.debug);
        }

        let allprograms = await readAllLines(args.input_file)
            .pipe(new DatasetParser({ contextual: args.contextual }))
            .pipe(new ContextExtractor({
                targetLanguage: args.target_language,
                schemaRetriever: schemas,
                rng
            }))
            .read();

        for (let prog of allprograms) {
            args.output.write(prog);
            args.output.write('\n');
        }
        args.output.end();

        await StreamUtils.waitFinish(args.output);
    }
};
