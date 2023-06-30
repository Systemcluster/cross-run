#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

import { program } from 'commander'
import dotenv from 'dotenv'
import expand from 'dotenv-expand'

import { run } from './index.js'

program
    .name('cross-run')
    .description('Utility to run commands with cross-platform environment variable expansion.')
    .version('0.1.0')
    .option('-e, --env', 'Load environment variables from .env file', false)
    .option('-s, --strict', 'Error when encountering unknown environment variables during expansion', false)
    .option('-m, --multiple', 'Run multiple commands sequentially', false)
    .option('-p, --parallel', 'Run multiple commands in parallel', false)
    .allowExcessArguments(true)
    .passThroughOptions(true)

program.parse()

const opts = program.opts()
const args = program.args

if (opts.multiple && opts.parallel) {
    console.error('Cannot use both --multiple and --parallel')
    process.exitCode = 1
} else {
    const node_env = process.env.NODE_ENV ?? 'development'
    const cwd = process.cwd()
    if (opts.env) {
        for (const file of ['.env', '.env.local', `.env.${node_env}`, `.env.${node_env}.local`]) {
            const env = path.resolve(cwd, file)
            if (fs.existsSync(env)) {
                try {
                    const config = dotenv.config({ path: env })
                    if (config.error) {
                        throw config.error
                    }
                    expand.expand(config)
                } catch {
                    console.warn(`Failed to load ${file}`)
                }
            }
        }
    }
}

try {
    await run(args, opts.multiple ? 'multiple' : opts.parallel ? 'parallel' : 'single', opts.strict)
} catch (error) {
    console.error(error)
    process.exitCode = 1
}