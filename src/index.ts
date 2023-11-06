import child_process from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import chalk, { ChalkInstance } from 'chalk'
import { minimatch } from 'minimatch'
import shlex from 'shlex'
import which from 'which'

export type RunMode = 'single' | 'multiple' | 'parallel'

export type PackageManager = 'npm' | 'yarn' | 'pnpm'

export interface Config {
    mode: RunMode
    strict: boolean
    raw: boolean
    verbose: boolean
    pm: PackageManager | null
}

export interface Prefix {
    text?: string
    color: ChalkInstance
}

export const expandEnv = (string: string, env: Record<string, string>, strict: boolean = false): string => {
    const getEnv = (name: string) => {
        if (name in env) {
            return env[name]!
        }
        if (strict) {
            throw new Error(`Unknown environment variable ${name}`)
        }
        return ''
    }
    return string
        .replaceAll(/\$\{([a-zA-Z0-9-_]+)\}/gu, (_, name) => `${getEnv(name)}`)
        .replaceAll(/\$([a-zA-Z0-9-_]+)/gu, (_, name) => `${getEnv(name)}`)
        .replaceAll(/%([a-zA-Z0-9-_]+)%/gu, (_, name) => `${getEnv(name)}`)
}

export const escapePath = (path: string): string => {
    return os.platform() !== 'win32' ? path.replaceAll(/(\s+)/gu, '\\$1') : path.replaceAll(/(\s)/gu, `"$1"`)
}

const spawnCommand = async (command: string, args: string[], env: Record<string, string>, config: Config, prefix: Prefix) => {
    return new Promise<0>((resolve, reject) => {
        const escapedCommand = escapePath(command)
        if (config.verbose) {
            if (prefix.text !== undefined) {
                process.stderr.write(prefix.color(` ${prefix.text} `))
                process.stderr.write(' ')
            }
            process.stderr.write(chalk.gray(`${escapedCommand} ${args.join(' ')}`))
            process.stderr.write('\n')
        }
        const child = child_process.spawn(escapedCommand, args, {
            stdio: 'pipe',
            shell: true,
            env,
        })
        child.stdout.on('data', (data) => {
            if (!config.raw && prefix.text !== undefined) {
                process.stdout.write(prefix.color(` ${prefix.text} `))
                process.stdout.write(' ')
            }
            process.stdout.write(data)
            if (!config.raw && typeof data === 'string' && !data.endsWith('\n')) {
                process.stdout.write('\n')
            }
        })
        child.stderr.on('data', (data) => {
            if (!config.raw && prefix.text !== undefined) {
                process.stderr.write(prefix.color(` ${prefix.text} `))
                process.stderr.write(' ')
            }
            process.stderr.write(data)
            if (!config.raw && typeof data === 'string' && !data.endsWith('\n')) {
                process.stderr.write('\n')
            }
        })
        child.on('error', (error) => {
            if (!config.raw && prefix.text !== undefined) {
                process.stderr.write(prefix.color(` ${prefix.text} `))
                process.stderr.write(' ')
            }
            process.stderr.write(chalk.red(error.message))
            if (!error.message.endsWith('\n')) {
                process.stderr.write('\n')
            }
            reject(-1)
        })
        child.on('exit', (code) => {
            if (code === 0) {
                resolve(code)
            } else {
                if (prefix.text !== undefined) {
                    process.stderr.write(prefix.color(` ${prefix.text} `))
                    process.stderr.write(' ')
                }
                process.stderr.write(chalk.red(`Command exited with code ${code ?? -1}.`))
                process.stderr.write('\n')
                reject(-1)
            }
        })
    })
}

const colors = [chalk.bgGreen, chalk.bgYellow, chalk.bgBlue, chalk.bgMagenta, chalk.bgCyan, chalk.bgRed]
const colorState = { current: 0 } as { current: number }

export const runPackageScript = async (
    script: string,
    args: string[],
    env: Record<string, string>,
    config: Config,
    pm: string,
    prefix?: boolean
) => {
    if (script.includes('*')) {
        const packagejson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
        const scripts = Object.keys(packagejson.scripts ?? {})
        const matches = scripts.filter((s) => minimatch(s, script))
        if (matches.length === 0) {
            throw new Error(`No scripts matched ${script}`)
        }
        if (config.mode === 'parallel') {
            const promises = matches.map((s) => {
                const prefixInstance = {
                    text: prefix ? `${script.split(' ')[0]}` : undefined,
                    color: colors[colorState.current++ % colors.length]!,
                }
                return spawnCommand(pm, ['run', s, ...args], env, config, prefixInstance)
            })
            const results = await Promise.allSettled(promises)
            for (const result of results) {
                if (result.status === 'rejected') {
                    throw result.reason
                }
            }
            return 0
        } else {
            for (const s of matches) {
                const prefixInstance = {
                    text: prefix ? `${s.split(' ')[0]}` : undefined,
                    color: colors[colorState.current++ % colors.length]!,
                }
                await spawnCommand(pm, ['run', s, ...args], env, config, prefixInstance)
            }
            return 0
        }
    }
    const prefixInstance = {
        text: prefix ? `${script.split(' ')[0]}` : undefined,
        color: colors[colorState.current++ % colors.length]!,
    }
    return spawnCommand(pm, ['run', script, ...args], env, config, prefixInstance)
}

export const runCommand = async (
    command: string,
    args: string[],
    env: Record<string, string>,
    config: Config,
    pm: string | null,
    prefix?: boolean
) => {
    if (command.startsWith('npm:')) {
        if (!pm) {
            throw new Error(`Can't run ${command}, no package manager available`)
        }
        return runPackageScript(command.slice(4), args, env, config, pm, prefix)
    }
    const prefixInstance = {
        text: prefix ? `${command.split('/').reverse()[0]?.split(' ')[0]}` : undefined,
        color: colors[colorState.current++ % colors.length]!,
    }
    return spawnCommand(command, args, env, config, prefixInstance)
}

export const run = async (args: string[], config: Config) => {
    const extraEnvs = {} as Record<string, string>
    for (const arg of args) {
        if (/^[a-zA-Z0-9-_]+=./u.test(arg)) {
            const [name, value] = arg.split('=', 2)
            extraEnvs[name!] = value!
        }
    }
    const env = { ...(process.env as Record<string, string>), ...extraEnvs }
    args = args.slice(Object.values(extraEnvs).length)
    if (args.length === 0) {
        return
    }
    const pm = config.pm ? checkInstallation(config.pm) : detectPackageManager()
    switch (config.mode) {
        case 'single': {
            const expanded = args.map((arg) => expandEnv(arg, env, config.strict))
            if (expanded.length === 0) {
                return
            }
            return runCommand(expanded[0]!, expanded.slice(1), env, config, pm, false)
        }
        case 'multiple': {
            for (const arg of args) {
                const split = shlex.split(arg)
                const expanded = split.map((arg) => expandEnv(arg, env, config.strict))
                if (split.length === 0) {
                    continue
                }
                await runCommand(expanded[0]!, expanded.slice(1), env, config, pm, true)
            }
            return 0
        }
        case 'parallel': {
            const promises = [] as Promise<0>[]
            for (const arg of args) {
                const split = shlex.split(arg)
                const expanded = split.map((arg) => expandEnv(arg, env, config.strict))
                if (split.length === 0) {
                    continue
                }
                promises.push(runCommand(expanded[0]!, expanded.slice(1), env, config, pm, true))
            }
            const results = await Promise.allSettled(promises)
            for (const result of results) {
                if (result.status === 'rejected') {
                    throw result.reason
                }
            }
            return 0
        }
    }
}

const checkLockFile = (root: string, pm: PackageManager) => {
    switch (pm) {
        case 'yarn': {
            return fs.existsSync(path.resolve(root, 'yarn.lock'))
        }
        case 'pnpm': {
            return fs.existsSync(path.resolve(root, 'pnpm-lock.yaml'))
        }
        case 'npm': {
            return fs.existsSync(path.resolve(root, 'package-lock.json'))
        }
    }
}

const checkInstallation = (pm: PackageManager) => {
    return which.sync(pm, { nothrow: true })
}

const detectPackageManager = (cwd?: string, fallback: PackageManager = 'npm'): string | null => {
    cwd = cwd ?? process.cwd()
    const pms: PackageManager[] = ['yarn', 'pnpm', 'npm']
    for (const pm of pms) {
        if (checkLockFile(cwd, pm)) {
            const path = checkInstallation(pm)
            if (path !== null) {
                return path
            }
        }
    }
    const path = checkInstallation(fallback)
    if (path !== null) {
        return path
    }
    return null
}
