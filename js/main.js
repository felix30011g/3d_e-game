import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Editor } from './editor.js';
window.THREE = THREE

class Game {
    constructor() {
        // ВАЖНО: renderer первым — иначе renderer.domElement не существует
        this._initRenderer();
        this._initScene();

        // Проверка, что canvas реально создан
        if (!this.renderer.domElement) {
            throw new Error('renderer.domElement не создан — проверь _initRenderer');
        }

        this.world  = new World(this.scene);
        this.player = new Player(this.camera, this.renderer.domElement, this.world);

        // Передаём domElement в Editor явно
        this.editor = new Editor(
            this.scene,
            this.camera,
            this.player,
            this.world,
            this.renderer.domElement
        );

        this.player.editor = this.editor;

        this.clock = new THREE.Clock();
        this.fpsAcc = 0;
        this.fpsFrames = 0;

        this._addStarterObjects();
        window.addEventListener('resize', () => this._onResize());
        this._loop();
    }

    _initRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
		this.renderer.autoClear = false;                 // ← ДОБАВИТЬ
        document.body.appendChild(this.renderer.domElement);
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x8fc9ff, 60, 280);
        this.camera = new THREE.PerspectiveCamera(
            75, window.innerWidth / window.innerHeight, 0.1, 500
        );
    }

    _addStarterObjects() {
        const mat = new THREE.MeshStandardMaterial({ color: 0xcc8844, roughness: 0.7 });
        const positions = [
            [ 3, 0.5, 0], [ -3, 0.5, 0], [0, 0.5, -3],
            [ 3, 1.5, 0], [ 0, 0.5, 3]
        ];
        for (const [x, y, z] of positions) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), mat.clone());
            m.position.set(x, y, z);
            this.world.add(m);
        }
    }

    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    _loop() {
        requestAnimationFrame(() => this._loop());
        const dt = Math.min(this.clock.getDelta(), 0.05);

        if (this.editor.active) {
            this.editor.update(dt);
        } else {
            this.player.update(dt);
        }

        const p = this.player.position;
        document.getElementById('pos').textContent =
            `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;

        this.fpsAcc += dt;
        this.fpsFrames++;
        if (this.fpsAcc >= 0.5) {
            document.getElementById('fps').textContent =
                Math.round(this.fpsFrames / this.fpsAcc);
            this.fpsAcc = 0;
            this.fpsFrames = 0;
        }

		 // === Рендер ===
		// 1. Чистим всё
		this.renderer.clear();

		// 2. Основная сцена
		this.renderer.render(this.scene, this.camera);

		// 3. Гизмо — поверх всего
		if (this.editor.active) {
			this.renderer.clearDepth();                 // стереть depth основного прохода
			this.editor.gizmo.render(this.renderer);    // нарисовать гизмо без преград
		}
    }
}

window.game = new Game()