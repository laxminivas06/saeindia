/**
 * Test Box & QR Target Generator Workbench
 * Allows instant generation of physical box target mockups with high-contrast QR codes
 * for immediate testing and verification on any screen or paper print.
 */

class TestGenerator {
  constructor() {
    this.container = document.getElementById('generated-qrcode');
    this.boxLabel = document.getElementById('gen-box-label');
    this.typeSelect = document.getElementById('gen-type-select');
    this.boxIdInput = document.getElementById('gen-box-id');
    this.missionInput = document.getElementById('gen-mission-id');
    this.customTextInput = document.getElementById('gen-custom-text');
    this.customFieldGroup = document.getElementById('gen-custom-group');
    this.standardFieldGroup = document.getElementById('gen-standard-group');
    
    this.qrInstance = null;
    this._init();
  }

  _init() {
    if (this.typeSelect) {
      this.typeSelect.addEventListener('change', () => this._handleTypeChange());
    }

    [this.boxIdInput, this.missionInput, this.customTextInput].forEach(el => {
      if (el) el.addEventListener('input', () => this.generate());
    });

    const refreshBtn = document.getElementById('btn-refresh-qr');
    if (refreshBtn) refreshBtn.addEventListener('click', () => this.generate());

    const printBtn = document.getElementById('btn-print-box');
    if (printBtn) printBtn.addEventListener('click', () => window.print());

    // Initial render
    this.generate();
  }

  _handleTypeChange() {
    const val = this.typeSelect.value;
    if (val === 'custom') {
      if (this.customFieldGroup) this.customFieldGroup.style.display = 'flex';
      if (this.standardFieldGroup) this.standardFieldGroup.style.display = 'none';
    } else {
      if (this.customFieldGroup) this.customFieldGroup.style.display = 'none';
      if (this.standardFieldGroup) this.standardFieldGroup.style.display = 'flex';
    }
    this.generate();
  }

  getPayload() {
    const type = this.typeSelect ? this.typeSelect.value : 'json';
    const boxId = (this.boxIdInput && this.boxIdInput.value.trim()) || 'BOX001';
    const missionId = (this.missionInput && this.missionInput.value.trim()) || 'MISSION001';

    if (type === 'plain') {
      return { boxId, text: boxId };
    } else if (type === 'kv') {
      const text = `BOX_ID=${boxId}\nMISSION_ID=${missionId}\nLAT=17.3850\nLON=78.4867\nSTATUS=VERIFIED`;
      return { boxId, text };
    } else if (type === 'json') {
      const jsonObj = {
        box_id: boxId,
        mission_id: missionId,
        cargo: "FIELD_TELEMETRY",
        timestamp: new Date().toISOString()
      };
      return { boxId, text: JSON.stringify(jsonObj, null, 2) };
    } else {
      const custom = (this.customTextInput && this.customTextInput.value.trim()) || 'BOX999';
      return { boxId: 'CUSTOM', text: custom };
    }
  }

  generate() {
    if (!this.container) return;
    const { boxId, text } = this.getPayload();

    if (this.boxLabel) {
      this.boxLabel.textContent = `TARGET BOX: ${boxId}`;
    }

    this.container.innerHTML = '';

    if (typeof QRCode !== 'undefined') {
      try {
        this.qrInstance = new QRCode(this.container, {
          text: text,
          width: 220,
          height: 220,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (e) {
        console.warn("QRCode generation error", e);
      }
    }
  }
}

window.TestGenerator = TestGenerator;
