import * as THREE from 'three';

// Gumball: SVG axes indicator that rotates live with the camera,
// plus view preset buttons (TOP / FRONT / SIDE / PERSPECTIVE).
// Usage: const gumball = new Gumball(camera, cameraControls);  → call gumball.update() each frame.
export class Gumball {
    constructor(camera, cameraControls) {
        this.camera          = camera;
        this.cameraControls  = cameraControls;
        this.armLength       = 28;
        this.labelOffset     = 38;
        this.centerX         = 40;
        this.centerY         = 40;
        this.snapSpeed       = 0.08;
        this._snapTarget     = null;   // THREE.Vector3 — active during snap animation

        this.axisConfigs = [
            { key: 'x', color: '#ff4444', label: 'X', worldDir: new THREE.Vector3(1, 0, 0) },
            { key: 'y', color: '#44ff88', label: 'Y', worldDir: new THREE.Vector3(0, 1, 0) },
            { key: 'z', color: '#4488ff', label: 'Z', worldDir: new THREE.Vector3(0, 0, 1) },
        ];

        this.svgElements = {};
        this._buildSVG();
        this.viewButtons();
    }

    _buildSVG() {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '80');
        svg.setAttribute('height', '80');
        svg.style.cssText = 'position:fixed;bottom:16px;left:16px;pointer-events:none;';

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

        document.body.appendChild(svg);
    }

    viewButtons() {
        const presets = ['TOP', 'FRONT', 'SIDE', 'PERSPECTIVE'];

        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            bottom: 106px;
            left: 16px;
            width: 80px;
            display: flex;
            flex-direction: column;
            gap: 2px;
        `;

        for (const preset of presets) {
            const btn = document.createElement('button');
            btn.textContent = preset;
            btn.style.cssText = `
                width: 100%;
                padding: 4px 0;
                cursor: pointer;
                font-size: 10px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                background: #1f1f1f;
                color: #ebebeb;
                border: 1px solid #424242;
                border-radius: 2px;
            `;
            btn.addEventListener('mouseenter', () => { btn.style.background = '#4f4f4f'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = '#1f1f1f'; });
            btn.addEventListener('click', () => this.snapToView(preset.toLowerCase()));
            container.appendChild(btn);
        }

        document.body.appendChild(container);
    }

    snapToView(preset) {
        const orbitDist = this.camera.position.distanceTo(this.cameraControls.target);
        const diagDist  = orbitDist / Math.sqrt(3);

        const presetMap = {
            top:         { position: new THREE.Vector3(0, orbitDist, 0),            up: new THREE.Vector3(0, 0, -1) },
            front:       { position: new THREE.Vector3(0, 0, orbitDist),            up: new THREE.Vector3(0, 1,  0) },
            side:        { position: new THREE.Vector3(orbitDist, 0, 0),            up: new THREE.Vector3(0, 1,  0) },
            perspective: { position: new THREE.Vector3(diagDist, diagDist, diagDist), up: new THREE.Vector3(0, 1, 0) },
        };

        const snapTarget = presetMap[preset];
        if (!snapTarget) return;

        this.camera.up.copy(snapTarget.up);        // set immediately — avoids gimbal lock during lerp
        this._snapTarget = snapTarget.position;
        this.cameraControls.enabled = false;        // block orbit input during snap
    }

    update() {
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
