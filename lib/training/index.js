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

const BACKENDS = {
    'decanlp': require('./decanlp')
};
const DEFAULT_BACKEND = 'decanlp';

module.exports = {
    BACKENDS,
    DEFAULT_BACKEND,

    createJob(options) {
        return new BACKENDS[options.backend || DEFAULT_BACKEND](options);
    }
};
