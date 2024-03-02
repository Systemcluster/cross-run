# cross-run

**Utility to run commands with cross-platform environment variable expansion and more.**

Combines the utility of [cross-env](https://www.npmjs.com/package/cross-env), [cross-var](https://www.npmjs.com/package/cross-var), [dotenv-cli](https://www.npmjs.com/package/dotenv-cli), [concurrently](https://www.npmjs.com/package/concurrently) and more in one simple command.

## Usage

```
cross-run [options] <command>

Arguments:
  <command>  The command to run

Options:
  -V, --version           Output the version number
  -e, --env               Load environment variables from .env file (default: false)
  -s, --strict            Error when encountering unknown environment variables during expansion (default: false)
  -m, --multiple          Run multiple commands sequentially (default: false)
  -p, --parallel          Run multiple commands in parallel (default: false)
  -r, --raw               Output the raw output of commands (default: false)
  -v, --verbose           Output verbose information (default: false)
  -o, --override-pm [pm]  Override the package manager to use (pnpm, yarn, npm)
  -h, --help              Display help
```

### Examples

```bash
# Run a command with expanded environment variables
cross-run echo %ENV_VAR%
```

```bash
# Set environment variables for a command
cross-run NEW_ENV_VAR=bar echo %NEW_ENV_VAR%
```

```bash
# Run a command with environment variables from .env
cross-run -e echo %ENV_VAR_FROM_DOTENV%
```

```bash
# Run multiple package scripts with pnpm, yarn or npm in parallel
cross-run -p NODE_ENV=production npm:test npm:build
```

```bash
# Run multiple package scripts with pnpm, yarn or npm with wildcard expansion
cross-run -m npm:check:* npm:build "echo done!"
```
