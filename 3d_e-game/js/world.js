import * as THREE from 'three';

export class World {
    constructor(scene) {
        this.scene = scene;
        this.editableObjects = [];

        this._setupGround();
        this._setupSky();
    }

    _setupGround() {
        const geo = new THREE.PlaneGeometry(500, 500);
        this.groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x4a6a3a,
            roughness: 0.95,
            metalness: 0.0
        });
        const ground = new THREE.Mesh(geo, this.groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        ground.userData.isGround = true;
        this.scene.add(ground);
        this.ground = ground;

        const grid = new THREE.GridHelper(500, 100, 0x223311, 0x223311);
        grid.position.y = 0.01;
        grid.material.opacity = 0.35;
        grid.material.transparent = true;
        this.scene.add(grid);
        this.gridHelper = grid;
    }

    _setupSky(topColor = '#3a7bd5', midColor = '#8fc9ff', bottomColor = '#d8e9ff') {
        this.skyColors = { top: topColor, mid: midColor, bottom: bottomColor };

        const canvas = document.createElement('canvas');
        canvas.width = 2; canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, topColor);
        grad.addColorStop(0.5, midColor);
        grad.addColorStop(1, bottomColor);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 2, 256);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;

        if (this.skyTexture) this.skyTexture.dispose();
        this.skyTexture = tex;
        this.scene.background = tex;
    }

    setGroundColor(hex) {
        if (this.groundMaterial) this.groundMaterial.color.set(hex);
    }

    setGroundRoughness(v) {
        if (this.groundMaterial) {
            this.groundMaterial.roughness = v;
            this.groundMaterial.needsUpdate = true;
        }
    }

    setGroundMetalness(v) {
        if (this.groundMaterial) {
            this.groundMaterial.metalness = v;
            this.groundMaterial.needsUpdate = true;
        }
    }

    setSkyColors(top, mid, bottom) {
        this._setupSky(top, mid, bottom);
    }

    add(obj) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        this.scene.add(obj);
        if (!obj.userData.isGround) this.editableObjects.push(obj);
    }

    remove(obj) {
        const i = this.editableObjects.indexOf(obj);
        if (i >= 0) this.editableObjects.splice(i, 1);
        this.scene.remove(obj);
    }
}