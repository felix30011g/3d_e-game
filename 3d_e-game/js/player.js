import * as THREE from 'three';

export class Player {
    constructor(camera, domElement, world) {
        this.camera = camera;
        this.dom = domElement;
        this.world = world;

        this.position = new THREE.Vector3(0, 0, 10);
        this.velocity = new THREE.Vector3();
        this.eyeHeight = 1.7;
        this.radius = 0.35;

        this.walkSpeed = 6;
        this.runSpeed = 10;
        this.jumpSpeed = 7;
        this.gravity = 22;

        this.yaw = 0;
        this.pitch = 0;
        this.sensitivity = 0.0022;
        this.enabled = false;

        this.keys = {};

        this._bindInput();
        this._updateCamera();
    }

    _bindInput() {
        window.addEventListener('keydown', e => {
            this.keys[e.code] = true;
        });
        window.addEventListener('keyup', e => {
            this.keys[e.code] = false;
        });

        document.addEventListener('mousemove', e => {
            if (!this.enabled) return;
            this.yaw   -= e.movementX * this.sensitivity;
            this.pitch += e.movementY * this.sensitivity;   // инвертированная вертикаль
            this.pitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, this.pitch));
        });

        this.dom.addEventListener('click', () => {
            if (this.editor && this.editor.active) return;
            if (!this.enabled) this.lock();
        });

        document.addEventListener('pointerlockchange', () => {
            this.enabled = document.pointerLockElement === this.dom;
        });
    }

    lock()   { this.dom.requestPointerLock(); }
    unlock() { document.exitPointerLock(); }

    _updateCamera() {
        this.camera.position.copy(this.position);
        this.camera.position.y += this.eyeHeight;

        const dir = new THREE.Vector3(
            Math.sin(this.yaw) * Math.cos(this.pitch),
            Math.sin(this.pitch),
            Math.cos(this.yaw) * Math.cos(this.pitch)
        ).negate();
        this.camera.lookAt(this.camera.position.clone().add(dir));
    }

    update(dt) {
        if (this.editor && this.editor.active) return;

        if (!this.enabled) {
            this._updateCamera();
            return;
        }

        const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const right   = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

        const move = new THREE.Vector3();
        if (this.keys['KeyW']) move.add(forward);
        if (this.keys['KeyS']) move.sub(forward);
        if (this.keys['KeyD']) move.add(right);
        if (this.keys['KeyA']) move.sub(right);

        const running = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
        const speed = running ? this.runSpeed : this.walkSpeed;

        if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);

        this.velocity.x = move.x;
        this.velocity.z = move.z;

        const grounded = this.position.y <= 0.001;
        if (grounded && this.keys['Space']) {
            this.velocity.y = this.jumpSpeed;
        }
        this.velocity.y -= this.gravity * dt;

        this.position.addScaledVector(this.velocity, dt);
        if (this.position.y < 0) {
            this.position.y = 0;
            this.velocity.y = 0;
        }

        this._resolveCollisions();
        this._updateCamera();
    }

    _resolveCollisions() {
        const objs = this.world.editableObjects;
        for (const obj of objs) {
            if (!obj.geometry || obj.userData.isGround || obj.userData.isLightObject) continue;

            const box = new THREE.Box3().setFromObject(obj);
            const playerMin = new THREE.Vector3(
                this.position.x - this.radius, this.position.y, this.position.z - this.radius);
            const playerMax = new THREE.Vector3(
                this.position.x + this.radius, this.position.y + this.eyeHeight, this.position.z + this.radius);

            if (
                playerMax.x < box.min.x || playerMin.x > box.max.x ||
                playerMax.z < box.min.z || playerMin.z > box.max.z ||
                playerMax.y < box.min.y || playerMin.y > box.max.y
            ) continue;

            const dxMin = playerMax.x - box.min.x;
            const dxMax = box.max.x - playerMin.x;
            const dzMin = playerMax.z - box.min.z;
            const dzMax = box.max.z - playerMin.z;
            const dyMin = playerMax.y - box.min.y;
            const dyMax = box.max.y - playerMin.y;

            const m = Math.min(dxMin, dxMax, dzMin, dzMax, dyMin, dyMax);

            if (m === dxMin) this.position.x -= dxMin;
            else if (m === dxMax) this.position.x += dxMax;
            else if (m === dzMin) this.position.z -= dzMin;
            else if (m === dzMax) this.position.z += dzMax;
            else if (m === dyMin) { this.position.y -= dyMin; this.velocity.y = 0; }
            else if (m === dyMax) { this.position.y += dyMax; this.velocity.y = 0; }
        }
    }
}