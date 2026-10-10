import * as THREE from 'three';

export class World {
    constructor(scene) {
        this.scene = scene;
        this.editableObjects = []; // все, что можно редактировать

        this._setupLighting();
        this._setupGround();
        this._setupSky();
    }

    _setupLighting() {
        // Ambient — базовое освещение
        const ambient = new THREE.AmbientLight(0xffffff, 0.55);
        this.scene.add(ambient);

        // Солнце
        const sun = new THREE.DirectionalLight(0xfff0d0, 1.2);
        sun.position.set(50, 80, 30);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        const s = 120;
        sun.shadow.camera.left = -s;
        sun.shadow.camera.right = s;
        sun.shadow.camera.top = s;
        sun.shadow.camera.bottom = -s;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 300;
        this.scene.add(sun);

        // Небо-полусфера
        const hemi = new THREE.HemisphereLight(0x8fc9ff, 0x3a2d1f, 0.5);
        this.scene.add(hemi);
    }

    _setupGround() {
        // Огромная плоскость-пол
        const geo = new THREE.PlaneGeometry(500, 500);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x4a6a3a,
            roughness: 0.95,
            metalness: 0.0
        });
        const ground = new THREE.Mesh(geo, mat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        ground.userData.isGround = true;
        this.scene.add(ground);
        this.ground = ground;

        // Сетка для наглядности (помогает ориентироваться)
        const grid = new THREE.GridHelper(500, 100, 0x223311, 0x223311);
        grid.position.y = 0.01;
        grid.material.opacity = 0.35;
        grid.material.transparent = true;
        this.scene.add(grid);
    }

    _setupSky() {
        // Простой градиентный фон
        const canvas = document.createElement('canvas');
        canvas.width = 2; canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, '#3a7bd5');
        grad.addColorStop(0.5, '#8fc9ff');
        grad.addColorStop(1, '#d8e9ff');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 2, 256);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        this.scene.background = tex;
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