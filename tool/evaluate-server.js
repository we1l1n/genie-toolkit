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

const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');
const fs = require('fs');

const { DatasetParser } = require('../lib/dataset-parsers');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const ParserClient = require('./lib/parserclient');
const { SentenceEvaluatorStream, CollectSentenceStatistics } = require('../lib/evaluators');

function csvDisplay(args, complexity, result) {
    let buffer = '';
    if (args.csv_prefix)
        buffer = args.csv_prefix + ',';

    if (complexity === null) {
        buffer += 'all,';
        buffer += String(result.total);
    } else {
        if (!result[`complexity_${complexity}/total`])
            return;
        buffer += String(complexity) + ',' + String(result[`complexity_${complexity}/total`]);
    }
    for (let key of ['ok', 'ok_without_param', 'ok_function', 'ok_device', 'ok_num_function', 'ok_syntax']) {
        const fullkey = complexity === null ? key : `complexity_${complexity}/${key}`;
        result[fullkey].length = parseInt(process.env.CSV_LENGTH || 1);
        buffer += ',';
        buffer += String(result[fullkey]);
    }
    args.output.write(buffer + '\n');
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('evaluate-server', {
            addHelp: true,
            description: "Evaluate a trained model on a Genie-generated dataset, by contacting a running Genie server."
        });
        parser.addArgument(['-o', '--output'], {
            required: false,
            defaultValue: process.stdout,
            type: fs.createWriteStream,
            description: "Write results to this file instead of stdout"
        });
        parser.addArgument('--url', {
            required: false,
            help: "URL of the server to evaluate. Use a file:// URL pointing to a model directory to evaluate using a local instance of decanlp",
            defaultValue: 'http://127.0.0.1:8400',
        });
        parser.addArgument('--tokenized', {
            required: false,
            action: 'storeTrue',
            defaultValue: true,
            help: "The dataset is already tokenized (this is the default)."
        });
        parser.addArgument('--no-tokenized', {
            required: false,
            dest: 'tokenized',
            action: 'storeFalse',
            help: "The dataset is not already tokenized."
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--contextual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Process a contextual dataset.',
            defaultValue: false
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to evaluate (in TSV format); use - for standard input'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
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
        parser.addArgument('--csv', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Output a single CSV line',
        });
        parser.addArgument('--csv-prefix', {
            required: false,
            defaultValue: '',
            help: `Prefix all output lines with this string`
        });
    },

    async execute(args) {
        const tpClient = new Tp.FileClient(args);
        const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
        const parser = ParserClient.get(args.url, args.locale);
        await parser.start();

        const output = readAllLines(args.input_file)
            .pipe(new DatasetParser({ contextual: args.contextual, preserveId: true, parseMultiplePrograms: true }))
            .pipe(new SentenceEvaluatorStream(parser, schemas, args.tokenized, args.debug))
            .pipe(new CollectSentenceStatistics());

        const result = await output.read();

        if (args.csv) {
            csvDisplay(args, null, result);
            for (let complexity = 0; complexity < 10; complexity++)
                csvDisplay(args, complexity, result);
        } else {
            for (let key in result) {
                if (Array.isArray(result[key]))
                    args.output.write(`${key} = [${result[key].join(', ')}]\n`);
                else
                    args.output.write(`${key} = ${result[key]}\n`);
            }
        }
        args.output.end();

        await parser.stop();
    }
};
