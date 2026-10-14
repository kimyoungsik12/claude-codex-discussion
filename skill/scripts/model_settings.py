"""Read only saved model/effort choices; never import tools, hooks or permissions."""
import json
import os
from pathlib import Path
import re


def codex_values(path):
    if not path.exists():
        return {}
    # Deliberately narrow scalar reader for Python 3.10 (no extra dependency).
    # Other settings are neither interpreted nor forwarded to the child.
    section, values = '', {}
    for line in path.read_text('utf-8-sig').splitlines():
        stripped = line.strip()
        if stripped.startswith('['):
            section = stripped.split(']', 1)[0][1:].strip()
            continue
        match = re.match(r'^\s*(model|model_reasoning_effort|profile)\s*=\s*(.*)$', line)
        if not match:
            continue
        raw = match[2]
        if raw.startswith('"'):
            value, end = json.JSONDecoder().raw_decode(raw)
        elif raw.startswith("'"):
            end = raw.find("'", 1) + 1
            if end == 0:
                raise ValueError('Invalid Codex model setting')
            value = raw[1:end - 1]
        else:
            raise ValueError('Model settings must be quoted strings')
        if raw[end:].strip() and not raw[end:].lstrip().startswith('#'):
            raise ValueError('Unsupported Codex model setting syntax')
        values.setdefault(section, {})[match[1]] = value
    selected = dict(values.get('', {}))
    profile = selected.get('profile')
    if profile:
        selected.update(values.get('profiles.' + profile, values.get('profiles."' + profile + '"', {})))
    return selected


def selected_settings(provider, config):
    if provider == 'codex':
        base = Path(os.environ.get('CODEX_HOME') or str(Path.home() / '.codex')).expanduser()
        saved = codex_values(base / 'config.toml')
        model, effort = saved.get('model'), saved.get('model_reasoning_effort')
    else:
        base = Path(os.environ.get('CLAUDE_CONFIG_DIR') or str(Path.home() / '.claude')).expanduser()
        path = base / 'settings.json'
        saved = json.loads(path.read_text('utf-8-sig')) if path.exists() else {}
        model = os.environ.get('ANTHROPIC_MODEL') or saved.get('model')
        effort = os.environ.get('CLAUDE_CODE_EFFORT_LEVEL') or saved.get('effortLevel')
    model = config.get('models', {}).get(provider) or model
    effort = config.get('efforts', {}).get(provider) or effort
    for value in (model, effort):
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise ValueError('Model/effort must be nonempty strings')
    return {'model': model, 'effort': effort}


def apply_settings(cmd, provider, selected):
    args = []
    if selected['model']:
        args += ['--model', selected['model']]
    if selected['effort']:
        args += (['--effort', selected['effort']] if provider == 'claude' else
                 ['-c', 'model_reasoning_effort=' + json.dumps(selected['effort'])])
    position = 1 if provider == 'claude' else cmd.index('exec')
    cmd[position:position] = args
    return cmd
