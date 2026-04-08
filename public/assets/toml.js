(function(global) {
  function stripComments(line) {
    let result = '';
    let inString = false;
    let escape = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];

      if (char === '"' && !escape) inString = !inString;
      if (char === '#' && !inString) break;

      result += char;
      escape = char === '\\' && !escape;
      if (char !== '\\') escape = false;
    }

    return result.trim();
  }

  function splitTopLevel(value, delimiter) {
    const parts = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];

      if (char === '"' && !escape) inString = !inString;
      if (!inString) {
        if (char === '[') depth += 1;
        if (char === ']') depth -= 1;
      }

      if (char === delimiter && !inString && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }

      escape = char === '\\' && !escape;
      if (char !== '\\') escape = false;
    }

    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  function parseString(value) {
    return value
      .slice(1, -1)
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');
  }

  function parseMultilineString(value) {
    let content = value.slice(3, -3);
    if (content.startsWith('\n')) content = content.slice(1);
    return content.replace(/\\"/g, '"');
  }

  function parseValue(value) {
    const trimmed = value.trim();

    if (trimmed.startsWith('"""') && trimmed.endsWith('"""')) return parseMultilineString(trimmed);
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) return parseString(trimmed);

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) return [];
      return splitTopLevel(inner, ',').map(parseValue);
    }

    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (/^-?\d+\.\d+$/.test(trimmed)) return Number.parseFloat(trimmed);
    if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);

    throw new Error(`Unsupported TOML value: ${trimmed}`);
  }

  function parsePath(path) {
    return splitTopLevel(path, '.').map(segment => {
      const trimmed = segment.trim();
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) return parseString(trimmed);
      return trimmed;
    });
  }

  function resolveTarget(root, segments, createArrayItem) {
    let target = root;

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      if (isLast && createArrayItem) {
        if (!Array.isArray(target[segment])) target[segment] = [];
        const item = {};
        target[segment].push(item);
        return item;
      }

      if (Array.isArray(target[segment])) {
        if (target[segment].length === 0) target[segment].push({});
        target = target[segment][target[segment].length - 1];
        continue;
      }

      if (!target[segment] || typeof target[segment] !== 'object' || Array.isArray(target[segment])) {
        target[segment] = {};
      }

      target = target[segment];
    }

    return target;
  }

  function parse(source) {
    const root = {};
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    let current = root;

    for (let index = 0; index < lines.length; index += 1) {
      let line = stripComments(lines[index]);
      if (!line) continue;

      if (line.startsWith('[[') && line.endsWith(']]')) {
        current = resolveTarget(root, parsePath(line.slice(2, -2).trim()), true);
        continue;
      }

      if (line.startsWith('[') && line.endsWith(']')) {
        current = resolveTarget(root, parsePath(line.slice(1, -1).trim()), false);
        continue;
      }

      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) throw new Error(`Invalid TOML line: ${line}`);

      const key = line.slice(0, separatorIndex).trim();
      let valueSource = line.slice(separatorIndex + 1).trim();

      if (valueSource.startsWith('"""') && !valueSource.endsWith('"""')) {
        while (index + 1 < lines.length) {
          index += 1;
          valueSource += `\n${lines[index]}`;
          if (lines[index].includes('"""')) break;
        }
      }

      const path = parsePath(key);
      const container = path.length > 1
        ? resolveTarget(current, path.slice(0, -1), false)
        : current;

      container[path[path.length - 1]] = parseValue(valueSource);
    }

    return root;
  }

  global.TOML = { parse };
})(typeof window !== 'undefined' ? window : globalThis);
