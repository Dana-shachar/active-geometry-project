import * as THREE from 'three';

// Gumball: SVG axes indicator that rotates live with the camera,
// plus view preset buttons (TOP / FRONT / SIDE / PERSPECTIVE) and a RESET button.
// Usage: const gumball = new Gumball(camera, cameraControls, settings);  → call gumball.update() each frame.
export class Gumball {
    constructor(camera, cameraControls, settings, onZoomChange) {
        this.camera          = camera;
        this.cameraControls  = cameraControls;
        this.settings        = settings;
        this.onZoomChange    = onZoomChange ?? (() => {});
        this.armLength       = 28;
        this.labelOffset     = 38;
        this.centerX         = 40;
        this.centerY         = 40;
        this.snapSpeed       = 0.08;
        this._snapTarget     = null;
        this.zoomInput       = null;

        this.axisConfigs = [
            { key: 'x', color: '#ff4444', label: 'X', worldDir: new THREE.Vector3(1, 0, 0) },
            { key: 'y', color: '#44ff88', label: 'Y', worldDir: new THREE.Vector3(0, 1, 0) },
            { key: 'z', color: '#4488ff', label: 'Z', worldDir: new THREE.Vector3(0, 0, 1) },
        ];

        this.svgElements = {};
        this._buildPanel();
    }

    _buildPanel() {
        const btnStyle = `
            padding: 4px 8px;
            cursor: pointer;
            font-size: 10px;
            font-family: Helvetica, sans-serif;
            background: #0C0C0D;
            color: #ffffff;
            border: 1px solid #5B5B5B;
            border-radius: 4px;
            white-space: nowrap;
        `;

        // One container, bottom-left, flex column — items stack top-to-bottom,
        // container grows upward from the fixed bottom edge.
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            bottom: 16px;
            left: 16px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        `;

        // Zoom slider — sits above the view buttons, double gap below it
        const zoomRow = document.createElement('div');
        zoomRow.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:8px;';

        const zoomLabel = document.createElement('span');
        zoomLabel.textContent = 'Zoom';
        zoomLabel.style.cssText = 'font: 700 12px Helvetica, sans-serif; color: #ffffff; white-space: nowrap;';

        this.zoomInput = document.createElement('input');
        this.zoomInput.type  = 'range';
        this.zoomInput.min   = 10;
        this.zoomInput.max   = 400;
        this.zoomInput.step  = 1;
        this.zoomInput.value = this.settings.zoomLevel;
        this.zoomInput.style.cssText = `
            width: 80px;
            height: 2px;
            accent-color: #ffffff;
            cursor: pointer;
            -webkit-appearance: none;
            appearance: none;
            background: #5B5B5B;
            border-radius: 1px;
            outline: none;
        `;
        this.zoomInput.addEventListener('input', () => {
            this.settings.zoomLevel = parseFloat(this.zoomInput.value);
            this.onZoomChange(this.settings.zoomLevel);
        });

        zoomRow.appendChild(zoomLabel);
        zoomRow.appendChild(this.zoomInput);
        container.appendChild(zoomRow);

        // View preset buttons
        for (const preset of ['TOP', 'FRONT', 'SIDE', 'PERSPECTIVE']) {
            const btn = document.createElement('button');
            btn.textContent = preset;
            btn.style.cssText = btnStyle;
            btn.addEventListener('mouseenter', () => { btn.style.background = '#1A1A1A'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = '#0C0C0D'; });
            btn.addEventListener('click', () => this.snapToView(preset.toLowerCase()));
            container.appendChild(btn);
        }

        // Reset View button
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'RESET VIEW';
        resetBtn.style.cssText = btnStyle;
        resetBtn.addEventListener('mouseenter', () => { resetBtn.style.background = '#1A1A1A'; });
        resetBtn.addEventListener('mouseleave', () => { resetBtn.style.background = '#0C0C0D'; });
        resetBtn.addEventListener('click', () => this.ResetScene());
        container.appendChild(resetBtn);

        // SVG axis indicator — appended last so it sits at the bottom of the column
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '80');
        svg.setAttribute('height', '80');
        svg.style.cssText = 'pointer-events:none; margin-top:16px;';

        for (const config of this.axisConfigs) {
            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', String(this.centerX));
            line.setAttribute('y1', String(this.centerY));
            line.setAttribute('stroke', config.color);
            line.setAttribute('stroke-width', '2');
            line.setAttribute('stroke-linecap', 'round');
            svg.appendChild(line);

            const text = document.createElementNS(svgNS, 'text');
            text.setAttribute('fill', config.color);
            text.setAttribute('font-size', '11');
            text.setAttribute('font-family', 'monospace');
            text.setAttribute('font-weight', 'bold');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.textContent = config.label;
            svg.appendChild(text);

            this.svgElements[config.key] = { line, text };
        }

        container.appendChild(svg);
        document.body.appendChild(container);
    }

    ResetScene() {
        const perspDist = 80 / Math.sqrt(3);
        this.camera.position.set(perspDist, perspDist, perspDist);
        this.camera.up.set(0, 1, 0);
        this.cameraControls.target.set(0, 0, 0);
        this.cameraControls.update();
    }

    snapToView(preset) {
        const orbitDist = this.camera.position.distanceTo(this.cameraControls.target);
        const diagDist  = orbitDist / Math.sqrt(3);

        // Offset each preset by the current orbit target so the camera always frames
        // whatever the orbit is centered on, not the world origin.
        const orbitCenter = this.cameraControls.target;
        const presetMap = {
            top:         { position: new THREE.Vector3(0, orbitDist, 0).add(orbitCenter),             up: new THREE.Vector3(0, 0, -1) },
            front:       { position: new THREE.Vector3(0, 0, orbitDist).add(orbitCenter),             up: new THREE.Vector3(0, 1,  0) },
            side:        { position: new THREE.Vector3(orbitDist, 0, 0).add(orbitCenter),             up: new THREE.Vector3(0, 1,  0) },
            perspective: { position: new THREE.Vector3(diagDist, diagDist, diagDist).add(orbitCenter), up: new THREE.Vector3(0, 1,  0) },
        };

        const snapTarget = presetMap[preset];
        if (!snapTarget) return;

        this.camera.up.copy(snapTarget.up);        // set immediately — avoids gimbal lock during lerp
        this._snapTarget = snapTarget.position;
        this.cameraControls.enabled = false;        // block orbit input during snap
    }

    update() {
        // Sync zoom slider display (only when not focused, only when value changed)
        if (this.zoomInput && document.activeElement !== this.zoomInput) {
            const zoomStr = String(this.settings.zoomLevel);
            if (this.zoomInput.value !== zoomStr) this.zoomInput.value = zoomStr;
        }

        // Smooth snap animation
        if (this._snapTarget) {
            this.camera.position.lerp(this._snapTarget, this.snapSpeed);
            this.cameraControls.update();
            if (this.camera.position.distanceTo(this._snapTarget) < 0.001) {
                this.camera.position.copy(this._snapTarget);
                this._snapTarget = null;
                this.cameraControls.enabled = true;
            }
        }

        // SVG axes update
        // Column 0 of matrixWorld = camera's side direction in world space
        // Column 1 of matrixWorld = camera's up direction in world space
        const worldMatrix = this.camera.matrixWorld.elements;
        const cameraSide  = new THREE.Vector3(worldMatrix[0], worldMatrix[1], worldMatrix[2]);
        const cameraUp    = new THREE.Vector3(worldMatrix[4], worldMatrix[5], worldMatrix[6]);

        for (const config of this.axisConfigs) {
            const screenX = config.worldDir.dot(cameraSide);
            const screenY = config.worldDir.dot(cameraUp);

            const armEndX = this.centerX + screenX * this.armLength;
            const armEndY = this.centerY - screenY * this.armLength;   // SVG Y is inverted
            const letterX = this.centerX + screenX * this.labelOffset;
            const letterY = this.centerY - screenY * this.labelOffset;

            const { line, text } = this.svgElements[config.key];
            line.setAttribute('x2', armEndX.toFixed(1));
            line.setAttribute('y2', armEndY.toFixed(1));
            text.setAttribute('x', letterX.toFixed(1));
            text.setAttribute('y', letterY.toFixed(1));
        }
    }
}
