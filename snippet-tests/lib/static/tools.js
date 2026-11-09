'use strict'

// Syntax checks that use a real language tool when one is installed:
// python3 (ast), ruby -c, php -l, gofmt, bash -n. Each is optional; when the
// tool is missing the check is skipped and the regex-based rules still run.
//
// The tools only parse. Nothing in an example is executed here.

const { spawnSync } = require('child_process')
const { commandExists } = require('../env')

const available = {}
function has(cmd) {
  if (!(cmd in available)) available[cmd] = commandExists(cmd)
  return available[cmd]
}

function run(cmd, args, input) {
  const res = spawnSync(cmd, args, { input, encoding: 'utf8', timeout: 15000, windowsHide: true })
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error }
}

function firstLine(text) {
  return String(text || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
    .trim()
}

// python: parse with ast and also report bare true/false/null names, which
// parse fine but raise NameError at runtime (Python spells them True, False
// and None).
const PYTHON_CHECK = `
import ast, sys
src = sys.stdin.read()
try:
    tree = ast.parse(src)
except SyntaxError as e:
    print("SyntaxError line %s: %s" % (e.lineno, e.msg))
    sys.exit(2)
bad = sorted({(n.lineno, n.id) for n in ast.walk(tree) if isinstance(n, ast.Name) and n.id in ("true", "false", "null")})
for lineno, name in bad:
    fix = {"true": "True", "false": "False", "null": "None"}[name]
    print("NameError line %s: '%s' is not defined in Python (use %s)" % (lineno, name, fix))
sys.exit(3 if bad else 0)
`

function pythonCmd() {
  if (has('python3')) return 'python3'
  if (has('python')) return 'python'
  return null
}

function checkPython(code) {
  const cmd = pythonCmd()
  if (!cmd) return null
  const res = run(cmd, ['-I', '-c', PYTHON_CHECK], code)
  if (res.error) return null
  if (res.status === 0) return []
  return res.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const m = line.match(/line (\d+)/)
      return { rule: 'python-syntax', line: m ? Number(m[1]) : undefined, message: line }
    })
}

function checkRuby(code) {
  if (!has('ruby')) return null
  const res = run('ruby', ['-W0', '-c', '-'], code)
  if (res.error) return null
  if (res.status === 0) return []
  const msg = firstLine(res.stderr.replace(/^-:/gm, 'line '))
  const m = msg.match(/line (\d+)/)
  return [{ rule: 'ruby-syntax', line: m ? Number(m[1]) : undefined, message: `Ruby syntax error: ${msg}` }]
}

function checkPhp(code) {
  if (!has('php')) return null
  const src = /^\s*<\?php/.test(code) ? code : `<?php\n${code}`
  const res = run('php', ['-l'], src)
  if (res.error) return null
  if (res.status === 0) return []
  const msg = firstLine((res.stdout + '\n' + res.stderr).replace(/in (Standard input code|-) on line (\d+)/, 'on line $2'))
  const m = msg.match(/line (\d+)/)
  // The <?php line we added is line 1, so shift.
  const line = m ? Math.max(1, Number(m[1]) - (src === code ? 0 : 1)) : undefined
  return [{ rule: 'php-syntax', line, message: `PHP syntax error: ${msg.replace(/^PHP Parse error:\s*/, '')}` }]
}

// Go examples are fragments (no package or func). Wrap them in a function so
// gofmt can parse the statements; a fragment that already declares a package
// is parsed as is.
function checkGo(code) {
  if (!has('gofmt')) return null
  const wrapped = /^\s*package\s/m.test(code) ? code : `package main\nfunc main() {\n${code}\n}\n`
  const res = run('gofmt', ['-e'], wrapped)
  if (res.error) return null
  if (res.status === 0) return []
  const msg = firstLine(res.stderr.replace(/^<standard input>:/gm, 'line '))
  const m = msg.match(/line (\d+)/)
  const line = m ? Math.max(1, Number(m[1]) - (wrapped === code ? 0 : 2)) : undefined
  return [{ rule: 'go-syntax', line, message: `Go syntax error: ${msg.replace(/^line \d+:\d+:\s*/, '')}` }]
}

function checkShellSyntax(code) {
  if (!has('bash')) return null
  const res = run('bash', ['-n'], code)
  if (res.error) return null
  if (res.status === 0) return []
  const msg = firstLine(res.stderr.replace(/^bash: line (\d+):/gm, 'line $1:'))
  const m = msg.match(/line (\d+)/)
  return [{ rule: 'shell-syntax', line: m ? Number(m[1]) : undefined, message: `shell syntax error: ${msg}` }]
}

module.exports = { checkPython, checkRuby, checkPhp, checkGo, checkShellSyntax, has }
