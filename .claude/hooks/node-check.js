// PostToolUse-Hook: geänderte JS-Datei mit `node --check` prüfen. Exit 2 = Fehler geht an Claude zurück.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
let f = '';
try { f = String(JSON.parse(fs.readFileSync(0, 'utf8')).tool_input?.file_path || ''); } catch { process.exit(0); }
if (!f.endsWith('.js') || !fs.existsSync(f)) process.exit(0);
try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
catch (e) { process.stderr.write(`node --check meldet einen Fehler:\n${e.stderr || e.message}\n`); process.exit(2); }
