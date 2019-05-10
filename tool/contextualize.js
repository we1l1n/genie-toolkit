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
const assert = require('assert');
const Stream = require('stream');

const { DatasetParser, DatasetStringifier } = require('../lib/dataset-parsers');
const I18n = require('../lib/i18n');
const { uniform, coin } = require('../lib/random');

const StreamUtils = require('../lib/stream-utils');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');

class ContextualizeStream extends Stream.Transform {
    constructor(locale, allprograms, rng) {
        super({ objectMode: true });

        this._locale = locale;
        this._templates = I18n.get(locale).CHANGE_SUBJECT_TEMPLATES.map((tpl) => tpl.split('{}'));
        for (let tpl of this._templates)
            assert.strictEqual(tpl.length, 2);

        this._allprograms = allprograms;
        this._rng = rng;
    }

    _transform(ex, encoding, callback) {
        if (coin(0.2, this._rng))
            ex.context = 'null';
        else
            ex.context = uniform(this._allprograms, this._rng);

        if (ex.context !== 'null' && this._templates.length > 0 && coin(0.1, this._rng)) {
            const template = uniform(this._templates, this._rng);

            ex.preprocessed = template[0] + ex.preprocessed + template[1];
        }

        callback(null, ex);
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('contextualize', {
            addHelp: true,
            description: "Transform a non-contextual dataset to a contextual one."
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
        parser.addArgument(['-c', '--context'], {
            required: true,
            action: 'append',
            type: fs.createReadStream,
            help: `Datasets to use as source of contexts`,
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to contextualize (in TSV format); use - for standard input'
        });
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
        });
    },

    async execute(args) {
        const rng = seedrandom.alea(args.random_seed);

        let allprograms = await readAllLines(args.context)
            .pipe(new DatasetParser())
            .pipe(new Stream.Transform({
                objectMode: true,

                transform(ex, encoding, callback) {
                    callback(null, ex.target_code);
                },

                flush(callback) {
                    process.nextTick(callback);
                }
            }))
            .pipe(new StreamUtils.SetAccumulator())
            .read();
        allprograms = Array.from(allprograms);

        await StreamUtils.waitFinish(
            readAllLines(args.input_file)
            .pipe(new DatasetParser())
            .pipe(new ContextualizeStream(args.locale, allprograms, rng))
            .pipe(new DatasetStringifier())
            .pipe(args.output)
        );
    }
};