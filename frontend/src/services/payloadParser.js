/**
 * Payload Parser for QR Scanners
 * Decodes JSON objects, key-value formatted text, and plain text.
 */

class PayloadParser {
  static parse(rawString) {
    if (!rawString || typeof rawString !== 'string') {
      return { type: 'empty', id: 'UNKNOWN', data: null, raw: '' };
    }

    const trimmed = rawString.trim();

    // 1. JSON
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsedJson = JSON.parse(trimmed);
        const id = parsedJson.box_id || parsedJson.id || parsedJson.target_id || parsedJson.code || 'QR-TARGET';
        const missionId = parsedJson.mission_id || parsedJson.mission || null;
        return {
          type: 'json',
          id: String(id),
          mission_id: missionId ? String(missionId) : null,
          data: parsedJson,
          raw: trimmed
        };
      } catch (e) {}
    }

    // 2. Key-Value pairs
    const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const kvRegex = /^([A-Za-z0-9_-]+)\s*[:=]\s*(.+)$/;
    const kvPairs = {};
    let isKV = false;

    for (const line of lines) {
      const match = line.match(kvRegex);
      if (match) {
        isKV = true;
        const key = match[1].toLowerCase().replace(/[-_]/g, '_');
        kvPairs[key] = match[2].trim();
      }
    }

    if (isKV && Object.keys(kvPairs).length > 0) {
      const id = kvPairs.box_id || kvPairs.id || kvPairs.target_id || 'QR-TARGET';
      const missionId = kvPairs.mission_id || kvPairs.mission || null;
      return {
        type: 'key_value',
        id: String(id),
        mission_id: missionId ? String(missionId) : null,
        data: kvPairs,
        raw: trimmed
      };
    }

    // 3. Plain Text
    let extractedId = trimmed;
    const match = trimmed.match(/([A-Z0-9_-]{3,})/i);
    if (match) {
      extractedId = match[0].toUpperCase();
    }

    return {
      type: 'text',
      id: extractedId,
      data: trimmed,
      raw: trimmed
    };
  }
}

window.PayloadParser = PayloadParser;
