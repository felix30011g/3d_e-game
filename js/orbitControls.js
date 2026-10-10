import * as THREE from 'three';

/**
 * Классическое управление камеры редактора:
 *  - ПКМ (drag)  → orbit вокруг target
 *  - СКМ (drag)  → pan
 *  - колесо      → zoom
 */
export class EditorCamera {
    constructor(camera, domElement) {
        this.camera = camera;
        this.dom = domElement;
		if (!this.dom) {
            throw new Error('EditorCamera: domElement не передан');
        }
        this.enabled = false;

        this.target = new THREE.Vector3(0, 1, 0);

        // Сферические координаты
        this.radius = 15;
        this.theta = 0;                // горизонталь
        this.phi = Math.PI / 3;        // вертикаль от +Y

        this.minRadius = 1;
        this.maxRadius = 200;
        this.minPhi = 0.05;
        this.maxPhi = Math.PI - 0.05;

        this.rotateSpeed = 0.005;
        this.panSpeed = 1;
        this.zoomSpeed = 1.1;

        this._dragging = null;  // 'rotate' | 'pan' | null
        this._lastX = 0;
        this._lastY = 0;

        this._bind();
        this.update();
    }

    _bind() {
        this.dom.addEventListener('mousedown', e => {
            if (!this.enabled) return;
            if (e.button === 2) { this._dragging = 'rotate'; }
            if (e.button === 1) { this._dragging = 'pan'; e.preventDefault(); }
            this._lastX = e.clientX;
            this._lastY = e.clientY;
        });

        window.addEventListener('mouseup', () => { this._dragging = null; });

        window.addEventListener('mousemove', e => {
            if (!this.enabled || !this._dragging) return;
            const dx = e.clientX - this._lastX;
            const dy = e.clientY - this._lastY;
            this._lastX = e.clientX;
            this._lastY = e.clientY;

            if (this._dragging === 'rotate') {
                this.theta -= dx * this.rotateSpeed;
                this.phi   -= dy * this.rotateSpeed;
                this.phi = Math.max(this.minPhi, Math.min(this.maxPhi, this.phi));
            } else if (this._dragging === 'pan') {
                // Смещение цели в плоскости камеры
                const forward = new THREE.Vector3().subVectors(this.target, this.camera.position).normalize();
                const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
                const up = new THREE.Vector3().crossVectors(right, forward).normalize();

                const dist = this.camera.position.distanceTo(this.target);
                const k = dist * 0.0015 * this.panSpeed;

                this.target.addScaledVector(right, -dx * k);
                this.target.addScaledVector(up, dy * k);
            }

            this.update();
        });

        this.dom.addEventListener('wheel', e => {
            if (!this.enabled) return;
            e.preventDefault();
            const factor = e.deltaY > 0 ? this.zoomSpeed : 1 / this.zoomSpeed;
            this.radius = Math.max(this.minRadius, Math.min(this.maxRadius, this.radius * factor));
            this.update();
        }, { passive: false });

        // Отключаем contextmenu уже в editor.js, но на всякий случай
        this.dom.addEventListener('contextmenu', e => e.preventDefault());
    }

    focusOn(point, distance = 6) {
        this.target.copy(point);
        this.radius = distance;
        this.update();
    }

    update() {
        const x = this.radius * Math.sin(this.phi) * Math.sin(this.theta);
        const y = this.radius * Math.cos(this.phi);
        const z = this.radius * Math.sin(this.phi) * Math.cos(this.theta);

        this.camera.position.set(
            this.target.x + x,
            this.target.y + y,
            this.target.z + z
        );
        this.camera.lookAt(this.target);
    }

    // Raycast из позиции мыши
    raycastFromMouse(mouseNdc, objects) {
        const ray = new THREE.Raycaster();
        ray.setFromCamera(mouseNdc, this.camera);
        return ray.intersectObjects(objects, false);
    }
}