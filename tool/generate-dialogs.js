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

const fs = require('fs');
const JSONStream = require('JSONStream');
const Stream = require('stream');

const parallelize = require('../lib/parallelize');
const { DatasetParser } = require('../lib/dataset-parsers');
const { AVAILABLE_LANGUAGES } = require('../lib/languages');

const StreamUtils = require('../lib/stream-utils');
const { ActionSetFlag, maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const ProgressBar = require('./lib/progress_bar');

const DIALOG_SERIALIZERS = {
    json() {
        return JSONStream.stringify(undefined, undefined, undefined, 2);
    },

    txt() {
        return new Stream.Transform({
            writableObjectMode: true,

            transform(dlg, encoding, callback) {
                this.push('====\n');
                this.push('# ' + dlg.id + '\n');

                for (let i = 0; i < dlg.turns.length; i++) {
                    const turn = dlg.turns[i];
                    if (i > 0)
                        this.push('S: ' + turn.system + '\n');
                    this.push('U: ' + turn.user + '\n');
                    this.push('A: ' + turn.target + '\n');
                }

                callback();
            },

            flush(callback) {
                process.nextTick(callback);
            }
        });
    },

    txt_only() {
        return new Stream.Transform({
            writableObjectMode: true,

            transform(dlg, encoding, callback) {
                this.push('====\n');

                this.push('# ' + dlg.id + '\n');
                for (let i = 0; i < dlg.turns.length; i++) {
                    const turn = dlg.turns[i];
                    if (i > 0)
                        this.push('S: ' + turn.system + '\n');
                    this.push('U: ' + turn.user + '\n');
                }
                callback();
            },

            flush(callback) {
                callback();
            }
        });
    }
};

class SimpleCountStream extends Stream.Transform {
    constructor(N) {
        super({ objectMode: true });

        this._i = 0;
        this._N = N;
    }

    _transform(element, encoding, callback) {
        this._i ++;
        if (this._i % 100 === 0)
            this.emit('progress', this._i/this._N);
        callback(null, element);
    }

    _flush(callback) {
        callback();
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('generate-dialogs', {
            addHelp: true,
            description: "Generate a new synthetic dialog dataset, given a template file."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Dataset containing starting sentences'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
        });
        parser.addArgument(['-n', '--target-size'], {
            required: false,
            defaultValue: 1000000,
            type: Number,
            help: `Number of dialogues to generate`
        });
        parser.addArgument(['-f', '--output-format'], {
            required: false,
            defaultValue: 'txt-only',
            choices: ['json', 'txt', 'txt-only'],
            help: `Output format`
        });
        parser.addArgument(['--max-turns'], {
            required: false,
            defaultValue: 7,
            type: Number,
            help: `Maximum number of turns per dialog`
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
        parser.addArgument('--entities', {
            required: false,
            help: 'Path to JSON file containing entity type definitions.'
        });
        parser.addArgument('--dataset', {
            required: false,
            help: 'Path to file containing primitive templates, in ThingTalk syntax.'
        });
        parser.addArgument('--template', {
            required: true,
            nargs: '+',
            help: 'Path to file containing construct templates, in Genie syntax.'
        });
        parser.addArgument('--set-flag', {
            required: false,
            nargs: 1,
            action: ActionSetFlag,
            constant: true,
            metavar: 'FLAG',
            help: 'Set a flag for the construct template file.',
        });
        parser.addArgument('--unset-flag', {
            required: false,
            nargs: 1,
            action: ActionSetFlag,
            constant: false,
            metavar: 'FLAG',
            help: 'Unset (clear) a flag for the construct template file.',
        });
        parser.addArgument('--maxdepth', {
            required: false,
            type: Number,
            defaultValue: 4,
            help: 'Maximum depth of sentence generation',
        });
        parser.addArgument('--target-pruning-size', {
            required: false,
            type: Number,
            defaultValue: 100,
            help: 'Approximate target size of the generate dataset, for each $root rule and each depth, for each minibatch of dialogues',
        });
        parser.addArgument(['-B', '--minibatch-size'], {
            required: false,
            type: Number,
            defaultValue: 1000,
            help: 'Size of the dialog minibatch',
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
        parser.addArgument('--parallelize', {
            type: Number,
            help: 'Run N threads in parallel (requires --experimental-worker support)',
            metavar: 'N',
            defaultValue: 1,
        });
    },

    async execute(args) {
        const inputFile = readAllLines(args.input_file);
        const outputFile = args.output;

        // divide target size for each thread
        args.target_size = Math.floor(args.target_size / args.parallelize);
        const counter = new SimpleCountStream(args.target_size * args.parallelize);


        delete args.input_file;
        delete args.output;
        inputFile
            .pipe(new DatasetParser())
            .pipe(parallelize(args.parallelize, require.resolve('./workers/generate-dialogs-worker.js'), args))
            .pipe(counter)
            .pipe(DIALOG_SERIALIZERS[args.output_format.replace('-', '_')]())
            .pipe(outputFile);

        if (!args.debug) {
            const progbar = new ProgressBar(1);
            counter.on('progress', (value) => {
                //console.log(value);
                progbar.update(value);
            });

            // issue an update now to show the progress bar
            progbar.update(0);
        }

        await StreamUtils.waitFinish(outputFile);
    }
};
