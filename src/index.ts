import child_process from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { minimatch } from 'minimatch'
import shlex from 'shlex'
import which from 'which'

export type RunMode = 'single' | 'multiple' | 'parallel'

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

const spawnCommand = async (command: string, args: string[], env: Record<string, string>) => {
    return new Promise<0>((resolve, reject) => {
        const child = child_process.spawn(command, args, {
            stdio: 'inherit',
            shell: true,
            env,
        })
        child.on('error', reject)
        child.on('exit', (code) => {
            if (code === 0) {
                resolve(code)
            } else {
                reject(new Error(`Command exited with code ${code ?? -1}`))
            }
        })
    })
}

export const runPackageScript = async (script: string, args: string[], env: Record<string, string>, mode: RunMode, pm: string) => {
    if (script.includes('*')) {
        const packagejson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
        const scripts = Object.keys(packagejson.scripts ?? {})
        const matches = scripts.filter((s) => minimatch(s, script))
        if (matches.length === 0) {
            throw new Error(`No scripts matched ${script}`)
        }
        if (mode === 'parallel') {
            const promises = matches.map((s) => spawnCommand(pm, ['run', s, ...args], env))
            const results = await Promise.allSettled(promises)
            for (const result of results) {
                if (result.status === 'rejected') {
                    throw result.reason
                }
            }
            return 0
        } else {
            for (const s of matches) {
                await spawnCommand(pm, ['run', s, ...args], env)
            }
            return 0
        }
    }
    return spawnCommand(pm, ['run', script, ...args], env)
}

export const runCommand = async (command: string, args: string[], env: Record<string, string>, mode: RunMode, pm: string | null) => {
    if (command.startsWith('npm:')) {
        if (!pm) {
            throw new Error(`Can't run ${command}, no package manager available`)
        }
        return runPackageScript(command.slice(4), args, env, mode, pm)
    }
    return spawnCommand(command, args, env)
}

export const run = async (args: string[], mode: RunMode = 'single', strict: boolean = false) => {
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
    const pm = detectPackageManager()
    switch (mode) {
        case 'single': {
            const expanded = args.map((arg) => expandEnv(arg, env, strict))
            if (expanded.length === 0) {
                return
            }
            return runCommand(expanded[0]!, expanded.slice(1), env, mode, pm)
        }
        case 'multiple': {
            for (const arg of args) {
                const split = shlex.split(arg)
                const expanded = split.map((arg) => expandEnv(arg, env, strict))
                if (split.length === 0) {
                    continue
                }
                await runCommand(expanded[0]!, expanded.slice(1), env, mode, pm)
            }
            return 0
        }
        case 'parallel': {
            const promises = [] as Promise<0>[]
            for (const arg of args) {
                const split = shlex.split(arg)
                const expanded = split.map((arg) => expandEnv(arg, env, strict))
                if (split.length === 0) {
                    continue
                }
                promises.push(runCommand(expanded[0]!, expanded.slice(1), env, mode, pm))
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

type PackageManager = 'npm' | 'yarn' | 'pnpm'

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
