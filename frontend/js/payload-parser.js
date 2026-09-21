/**
 * Payload Parser for Autonomous QR Scanners
 * Parses plain text, key-value formatted text, and JSON structures.
 */

class PayloadParser {
  static parse(rawString) {
    if (!rawString || typeof rawString !== 'string') {
      return {
        type: 'empty',
        box_id: 'UNKNOWN',
        data: null,
        raw: ''
      };
    }

    const trimmed = rawString.trim();

    // 1. Try JSON parsing
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsedJson = JSON.parse(trimmed);
        const boxId = parsedJson.box_id || parsedJson.boxId || parsedJson.id || parsedJson.box || 'UNKNOWN';
        const missionId = parsedJson.mission_id || parsedJson.missionId || parsedJson.mission || null;
        return {
          type: 'json',
          box_id: String(boxId),
          mission_id: missionId ? String(missionId) : null,
          data: parsedJson,
          raw: trimmed
        };
      } catch (e) {
        // Fallthrough to key-value or plain
      }
    }

    // 2. Try Key-Value format (lines with KEY=VALUE or KEY:VALUE)
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
      const boxId = kvPairs.box_id || kvPairs.boxid || kvPairs.id || kvPairs.box || 'UNKNOWN';
      const missionId = kvPairs.mission_id || kvPairs.missionid || kvPairs.mission || null;
      return {
        type: 'key_value',
        box_id: String(boxId),
        mission_id: missionId ? String(missionId) : null,
        data: kvPairs,
        raw: trimmed
      };
    }

    // 3. Fallback: Plain Text (Extract BOX ID pattern if present like BOX001)
    let extractedBoxId = trimmed;
    const boxMatch = trimmed.match(/BOX[-_]?[0-9A-Za-z]+/i);
    if (boxMatch) {
      extractedBoxId = boxMatch[0].toUpperCase();
    }

    return {
      type: 'text',
      box_id: extractedBoxId,
      data: trimmed,
      raw: trimmed
    };
  }
}

window.PayloadParser = PayloadParser;
