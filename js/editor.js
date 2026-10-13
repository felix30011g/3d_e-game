import * as THREE from 'three';
import { EditorCamera } from './orbitControls.js';
import { Gizmo } from './gizmo.js';
import { PropertiesPanel } from './properties.js';

const PRIMITIVES = {
    box:      () => new THREE.BoxGeometry(1, 1, 1),
    sphere:   () => new THREE.SphereGeometry(0.5, 32, 20),
    cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 28),
    cone:     () => new THREE.ConeGeometry(0.5, 1, 28),
    torus:    () => new THREE.TorusGeometry(0.5, 0.2, 16, 40),
    plane:    () => new THREE.PlaneGeometry(1, 1)
};

export class Editor {
    constructor(scene, camera, player, world, lighting, renderer, domElement) {
        this.scene = scene;
        this.camera = camera;
        this.player = player;
        this.world = world;
        this.lighting = lighting;
        this.renderer = renderer;
        this.dom = domElement;

        this.active = false;

        this.selection = [];
        this.pendingType = null;
        this.pendingGhost = null;
        this._lastMouseNdc = { x: 0, y: 0 };

        this.defaultMaterial = new THREE.MeshStandardMaterial({
            color: 0xcc8844,
            roughness: 0.7,
            metalness: 0.1
        });

        this.selectionBoxes = new THREE.Group();
        this.selectionBoxes.renderOrder = 998;
        this.scene.add(this.selectionBoxes);

        this.editorCamera = new EditorCamera(camera, domElement);
        this.editorCamera.enabled = false;

        this.gizmo = new Gizmo(scene, camera, domElement);
        this.gizmo.enabled = false;
        this.gizmo.onChange = (obj) => {
            this.properties.syncFrom(obj);
            this._updateSelectionBoxes();
        };

        this.properties = new PropertiesPanel();
        this.properties.onChange = (obj) => {
            this.gizmo.sync();
            this._updateSelectionBoxes();
        };
        this.properties.onDelete = () => this.deleteSelected();
        this.properties.onDuplicate = () => this.duplicateSelected();
        this.properties.onClose = () => this.deselectAll();

        this._raycaster = new THREE.Raycaster();
        this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

        this._bind();
    }

    // ============ Публичное API ============

    toggle() {
        this.active = !this.active;

        document.getElementById('mode').textContent = this.active ? 'Редактор' : 'Игра';
        document.body.classList.toggle('editor-mode', this.active);

        if (this.active) {
            this.player.unlock();

            this.editorCamera.enabled = true;
            const p = this.player.position.clone();
            const forward = new THREE.Vector3(
                -Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw)
            );
            this.editorCamera.target.copy(p.clone().addScaledVector(forward, 8));
            this.editorCamera.radius = 10;
            this.editorCamera.update();

            this.gizmo.enabled = true;
        } else {
            this.editorCamera.enabled = false;
            this.gizmo.enabled = false;
            this.gizmo.setTarget(null);
            this.deselectAll();
            this._cancelPending();
        }
    }

    update(dt) {
        if (!this.active) return;
        this.editorCamera.update();
        if (this.selection.length > 0) {
            this.gizmo.sync();
        }
        this._updatePendingGhost();
    }

    // ============ Ввод ============

    _bind() {
        window.addEventListener('keydown', e => {
            if (e.code === 'Tab') {
                e.preventDefault();
                this.toggle();
                return;
            }
            if (!this.active) return;

            if (e.code === 'Delete' || e.code === 'Backspace') {
                e.preventDefault();
                this.deleteSelected();
                return;
            }

            if (e.code === 'Escape') {
                this._cancelPending();
                this.deselectAll();
                return;
            }

            const primMap = {
                Digit1: 'box', Digit2: 'sphere', Digit3: 'cylinder',
                Digit4: 'cone', Digit5: 'torus', Digit6: 'plane'
            };
            if (primMap[e.code]) {
                this._startPending(primMap[e.code]);
                this._updatePaletteUI();
                return;
            }

            if (e.code === 'KeyL') {
                this._createLightAtCursor();
                return;
            }

            if (e.code === 'KeyG') this._setGizmoMode('translate');
            if (e.code === 'KeyR') this._setGizmoMode('rotate');
            if (e.code === 'KeyS') this._setGizmoMode('scale');

            if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.duplicateSelected();
            }

            if (e.code === 'KeyF') {
                this._focusSelection();
            }
        });

        document.querySelectorAll('.slot').forEach(slot => {
            slot.addEventListener('click', () => {
                this._startPending(slot.dataset.type);
                this._updatePaletteUI();
            });
        });

        this.dom.addEventListener('mousedown', e => this._onMouseDown(e));
        this.dom.addEventListener('mouseup',   e => this._onMouseUp(e));
        this.dom.addEventListener('mousemove', e => this._onMouseMove(e));
        this.dom.addEventListener('contextmenu', e => e.preventDefault());

        this._initSnapUI();
        this._initGraphicsUI();
    }

    _mouseNdc(e) {
        const rect = this.dom.getBoundingClientRect();
        return {
            x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
            y: -((e.clientY - rect.top) / rect.height) * 2 + 1
        };
    }

    _onMouseDown(e) {
        if (!this.active) return;
        this._downPos = { x: e.clientX, y: e.clientY, button: e.button };
    }

    _onMouseUp(e) {
        if (!this.active) return;
        if (!this._downPos) return;

        const dx = e.clientX - this._downPos.x;
        const dy = e.clientY - this._downPos.y;
        const dragDist = Math.hypot(dx, dy);

        const wasLeftClick = e.button === 0;
        const wasRightClick = e.button === 2;

        this._downPos = null;

        if (wasRightClick) return;
        if (dragDist > 4) return;

        if (wasLeftClick) {
            this._handleLeftClick(e);
        }
    }

    _onMouseMove(e) {
        if (!this.active) return;
        this._lastMouseNdc = this._mouseNdc(e);
        if (this.pendingGhost) {
            this._updatePendingGhost();
        }
    }

    // ============ Клик ============

    _normalizeHit(hitObject) {
        if (!hitObject) return null;
        let node = hitObject;
        while (node) {
            if (this.world.editableObjects.includes(node)) return node;
            node = node.parent;
        }
        return null;
    }

    _handleLeftClick(e) {
        const ndc = this._mouseNdc(e);
        this._raycaster.setFromCamera(ndc, this.camera);
        const hits = this._raycaster.intersectObjects(this.world.editableObjects, true);

        let picked = null;
        for (const h of hits) {
            const normalized = this._normalizeHit(h.object);
            if (normalized) { picked = normalized; break; }
        }

        if (this.pendingType) {
            let placeHit = null;
            for (const h of hits) {
                const normalized = this._normalizeHit(h.object);
                if (normalized && !normalized.userData.isLightObject) {
                    placeHit = h;
                    break;
                }
            }
            this._placePending(placeHit);
            this._cancelPending();
            this._updatePaletteUI();
            return;
        }

        if (picked) {
            this.select(picked, e.shiftKey);
        } else {
            if (!e.shiftKey) this.deselectAll();
        }
    }

    // ============ Выделение ============

    select(obj, additive = false) {
        if (!obj || !obj.isObject3D) {
            if (!additive) this.deselectAll();
            return;
        }

        if (!additive) {
            this.selection = [];
        }
        if (!this.selection.includes(obj)) {
            this.selection.push(obj);
        }
        this._applySelectionVisual();
        this._refreshGizmoTarget();
    }

    deselectAll() {
        this.selection = [];
        this._applySelectionVisual();
        this._refreshGizmoTarget();
        this.properties.setTarget(null);
    }

    _refreshGizmoTarget() {
        if (this.selection.length === 0) {
            this.gizmo.setTarget(null);
            this.properties.setTarget(null);
        } else {
            const last = this.selection[this.selection.length - 1];
            this.gizmo.setTarget(last);
            this.properties.setTarget(last);
        }
        this._updateSelectionBoxes();
    }

    _applySelectionVisual() {
        while (this.selectionBoxes.children.length > 0) {
            const c = this.selectionBoxes.children.pop();
            if (c.geometry) c.geometry.dispose();
            if (c.material) c.material.dispose();
        }

        this.selection = this.selection.filter(o => o && o.isObject3D);

        for (const obj of this.selection) {
            try {
                obj.updateMatrixWorld(true);

                const box = new THREE.Box3().setFromObject(obj);
                if (box.isEmpty()) continue;

                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());

                const helper = new THREE.Mesh(
                    new THREE.BoxGeometry(
                        Math.max(size.x, 0.02),
                        Math.max(size.y, 0.02),
                        Math.max(size.z, 0.02)
                    ),
                    new THREE.MeshBasicMaterial({
                        color: 0xffd86b, wireframe: true,
                        transparent: true, opacity: 0.5,
                        depthTest: false
                    })
                );
                helper.position.copy(center);
                helper.renderOrder = 998;
                this.selectionBoxes.add(helper);
            } catch (err) {
                console.warn('Рамка не построена для', obj, err);
            }
        }
    }

    _updateSelectionBoxes() {
        if (this.selection.length === 0) return;
        this._applySelectionVisual();
    }

    // ============ Создание объектов ============

    _startPending(type) {
        this.pendingType = type;
        this._createPendingGhost();
    }

    _cancelPending() {
        this.pendingType = null;
        if (this.pendingGhost) {
            this.scene.remove(this.pendingGhost);
            this.pendingGhost.geometry.dispose();
            this.pendingGhost.material.dispose();
            this.pendingGhost = null;
        }
    }

    _createPendingGhost() {
        if (this.pendingGhost) {
            this.scene.remove(this.pendingGhost);
            this.pendingGhost.geometry.dispose();
            this.pendingGhost.material.dispose();
        }
        if (!this.pendingType) return;
        const geo = PRIMITIVES[this.pendingType]();
        const mat = new THREE.MeshBasicMaterial({
            color: 0x66ccff, wireframe: true,
            transparent: true, opacity: 0.6, depthTest: false
        });
        this.pendingGhost = new THREE.Mesh(geo, mat);
        this.pendingGhost.renderOrder = 997;
        this.scene.add(this.pendingGhost);
    }

    _updatePendingGhost() {
        if (!this.pendingGhost) return;

        const ndc = this._lastMouseNdc || { x: 0, y: 0 };
        this._raycaster.setFromCamera(ndc, this.camera);

        const meshesOnly = this.world.editableObjects.filter(o => !o.userData.isLightObject);
        const hits = this._raycaster.intersectObjects(meshesOnly, true);

        let pos = null;
        if (hits[0]) {
            const p = hits[0].point.clone();
            const n = hits[0].face.normal.clone()
                .transformDirection(hits[0].object.matrixWorld);
            p.addScaledVector(n, 0.5);
            pos = p;
        } else {
            const point = new THREE.Vector3();
            const hit = this._raycaster.ray.intersectPlane(this._groundPlane, point);
            if (hit) {
                point.y = 0.5;
                pos = point;
            }
        }
        if (pos) {
            this.pendingGhost.position.copy(pos);
            this.pendingGhost.visible = true;
        } else {
            this.pendingGhost.visible = false;
        }
    }

    _placePending(objHit) {
        const type = this.pendingType;
        if (!type) return;

        const geo = PRIMITIVES[type]();
        const mat = this.defaultMaterial.clone();
        const mesh = new THREE.Mesh(geo, mat);

        const ndc = this._lastMouseNdc || { x: 0, y: 0 };
        this._raycaster.setFromCamera(ndc, this.camera);

        if (objHit) {
            const p = objHit.point.clone();
            const n = objHit.face.normal.clone().transformDirection(objHit.object.matrixWorld);
            p.addScaledVector(n, 0.5);
            mesh.position.copy(p);
        } else {
            const point = new THREE.Vector3();
            const hit = this._raycaster.ray.intersectPlane(this._groundPlane, point);
            if (!hit) return;
            point.y = 0.5;
            mesh.position.copy(point);
        }

        if (type === 'plane') {
            mesh.rotation.x = -Math.PI / 2;
        }

        if (this.gizmo.snapEnabled && this.gizmo.snapSize > 0) {
            const s = this.gizmo.snapSize;
            mesh.position.x = Math.round(mesh.position.x / s) * s;
            mesh.position.y = Math.max(s / 2, Math.round(mesh.position.y / s) * s);
            mesh.position.z = Math.round(mesh.position.z / s) * s;
        }

        this.world.add(mesh);
        this.select(mesh, false);
    }

    // ============ Свет ============

    _createLightAtCursor() {
        const pos = this.editorCamera.target.clone();
        const lightObj = this.lighting.createLight({
            x: pos.x,
            y: Math.max(3, pos.y + 2),
            z: pos.z,
            color: 0xffddaa,
            intensity: 2,
            distance: 15
        });

        // Регистрируем как редактируемый объект — БЕЗ повторного scene.add
        this.world.editableObjects.push(lightObj);

        this.select(lightObj, false);
    }

    // ============ Действия ============

    deleteSelected() {
        const toDelete = [...this.selection];
        this.deselectAll();
        for (const obj of toDelete) {
            if (obj.userData.isLightObject) {
                this.lighting.removeLight(obj);
                const i = this.world.editableObjects.indexOf(obj);
                if (i >= 0) this.world.editableObjects.splice(i, 1);
            } else {
                this.world.remove(obj);
                obj.geometry?.dispose();
                obj.material?.dispose();
            }
        }
    }

    duplicateSelected() {
        const copies = [];
        for (const obj of this.selection) {
            let copy;
            if (obj.userData.isLightObject) {
                copy = this.lighting.createLight({
                    x: obj.position.x + 1,
                    y: obj.position.y,
                    z: obj.position.z + 1,
                    color: obj.light.color.getHex(),
                    intensity: obj.light.intensity,
                    distance: obj.light.distance,
                    castShadow: obj.light.castShadow
                });
                this.world.editableObjects.push(copy);
            } else {
                copy = obj.clone();
                copy.material = obj.material.clone();
                copy.position.x += 1;
                copy.position.z += 1;
                this.world.add(copy);
            }
            copies.push(copy);
        }
        if (copies.length > 0) {
            this.selection = copies;
            this._applySelectionVisual();
            this._refreshGizmoTarget();
        }
    }

    _focusSelection() {
        if (this.selection.length === 0) return;
        const box = new THREE.Box3();
        for (const obj of this.selection) box.expandByObject(obj);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3()).length();
        this.editorCamera.focusOn(center, Math.max(3, size * 1.6));
    }

    _setGizmoMode(mode) {
        this.gizmo.setMode(mode);
    }

    _updatePaletteUI() {
        document.querySelectorAll('.slot').forEach(s => {
            s.classList.toggle('active', s.dataset.type === this.pendingType);
        });
    }

    // ============ Snap UI ============

    _initSnapUI() {
        const chk  = document.getElementById('snap-enabled');
        const size = document.getElementById('snap-size');

        const apply = () => {
            this.gizmo.snapEnabled = chk.checked;
            const s = parseFloat(size.value);
            if (!isNaN(s) && s > 0) this.gizmo.snapSize = s;
        };

        chk.addEventListener('change', apply);
        size.addEventListener('input', apply);
        size.addEventListener('keydown', e => e.stopPropagation());

        apply();
    }

    // ============ Graphics UI ============

    _initGraphicsUI() {
        const $ = id => document.getElementById(id);

        // Ambient
        $('light-ambient-color').addEventListener('input', e => {
            this.lighting.setAmbient(e.target.value, undefined);
        });
        $('light-ambient-intensity').addEventListener('input', e => {
            this.lighting.setAmbient(undefined, parseFloat(e.target.value));
            $('light-ambient-intensity-val').textContent = e.target.value;
        });

        // Sun
        $('light-sun-color').addEventListener('input', e => {
            this.lighting.setSun(e.target.value, undefined);
        });
        $('light-sun-intensity').addEventListener('input', e => {
            this.lighting.setSun(undefined, parseFloat(e.target.value));
            $('light-sun-intensity-val').textContent = e.target.value;
        });

        // Hemisphere
        $('light-hemi-sky').addEventListener('input', e => {
            this.lighting.setHemisphere(e.target.value, undefined);
        });
        $('light-hemi-ground').addEventListener('input', e => {
            this.lighting.setHemisphere(undefined, e.target.value);
        });
        $('light-hemi-intensity').addEventListener('input', e => {
            this.lighting.setHemisphere(undefined, undefined, parseFloat(e.target.value));
            $('light-hemi-intensity-val').textContent = e.target.value;
        });

        // Фон неба
        const applySky = () => {
            this.world.setSkyColors(
                $('world-sky-top').value,
                $('world-sky-mid').value,
                $('world-sky-bottom').value
            );
        };
        $('world-sky-top').addEventListener('input', applySky);
        $('world-sky-mid').addEventListener('input', applySky);
        $('world-sky-bottom').addEventListener('input', applySky);

        // Пол
        $('world-ground-color').addEventListener('input', e => {
            this.world.setGroundColor(e.target.value);
        });
        $('world-ground-roughness').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            this.world.setGroundRoughness(v);
            $('world-ground-roughness-val').textContent = v.toFixed(2);
        });
        $('world-ground-metalness').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            this.world.setGroundMetalness(v);
            $('world-ground-metalness-val').textContent = v.toFixed(2);
        });

        // Тени
        $('gfx-shadows').addEventListener('change', e => {
            this.lighting.setShadowsEnabled(e.target.checked);
            this.renderer.shadowMap.enabled = e.target.checked;
            this.renderer.shadowMap.needsUpdate = true;
            this.scene.traverse(o => {
                if (o.material) o.material.needsUpdate = true;
            });
        });

        $('gfx-shadow-res').addEventListener('change', e => {
            this.lighting.setShadowResolution(parseInt(e.target.value));
        });

        $('gfx-shadow-type').addEventListener('change', e => {
            const map = {
                basic:    THREE.BasicShadowMap,
                pcf:      THREE.PCFShadowMap,
                pcfsoft:  THREE.PCFSoftShadowMap,
                vsm:      THREE.VSMShadowMap
            };
            this.renderer.shadowMap.type = map[e.target.value] || THREE.PCFSoftShadowMap;
            this.renderer.shadowMap.needsUpdate = true;
            this.scene.traverse(o => {
                if (o.material) o.material.needsUpdate = true;
            });
        });

        // Туман
        $('gfx-fog-enabled').addEventListener('change', e => {
            if (e.target.checked) {
                this.scene.fog = new THREE.Fog(
                    parseInt($('gfx-fog-color').value.replace('#',''), 16),
                    parseFloat($('gfx-fog-near').value),
                    parseFloat($('gfx-fog-far').value)
                );
            } else {
                this.scene.fog = null;
            }
        });
        ['gfx-fog-color', 'gfx-fog-near', 'gfx-fog-far'].forEach(id => {
            $(id).addEventListener('input', () => {
                if (!this.scene.fog) return;
                this.scene.fog.color.set($('gfx-fog-color').value);
                this.scene.fog.near = parseFloat($('gfx-fog-near').value);
                this.scene.fog.far  = parseFloat($('gfx-fog-far').value);
            });
        });

        // Tone mapping
        $('gfx-tonemapping').addEventListener('change', e => {
            const map = {
                none:       THREE.NoToneMapping,
                linear:     THREE.LinearToneMapping,
                reinhard:   THREE.ReinhardToneMapping,
                cineon:     THREE.CineonToneMapping,
                aces:       THREE.ACESFilmicToneMapping
            };
            this.renderer.toneMapping = map[e.target.value] || THREE.NoToneMapping;
            this.scene.traverse(o => {
                if (o.material) o.material.needsUpdate = true;
            });
        });
        $('gfx-exposure').addEventListener('input', e => {
            this.renderer.toneMappingExposure = parseFloat(e.target.value);
            $('gfx-exposure-val').textContent = e.target.value;
        });

        // Pixel ratio
        $('gfx-pixelratio').addEventListener('change', e => {
            const v = e.target.value === 'auto'
                ? Math.min(window.devicePixelRatio, 2)
                : parseFloat(e.target.value);
            this.renderer.setPixelRatio(v);
        });

        // Кнопки
        $('gfx-save-btn').addEventListener('click', () => {
            this.saveGraphicsSettings();
            const btn = $('gfx-save-btn');
            btn.textContent = '✓ Сохранено';
            setTimeout(() => btn.textContent = '💾 Сохранить как дефолт', 1200);
        });

        $('gfx-reset-btn').addEventListener('click', () => {
            this.resetGraphicsSettings();
        });

        // Открытие/закрытие панели
        $('gfx-toggle').addEventListener('click', () => {
            $('gfx-panel').classList.toggle('open');
        });
        $('gfx-close').addEventListener('click', () => {
            $('gfx-panel').classList.remove('open');
        });
    }

    saveGraphicsSettings() {
        const data = {
            ambientColor: document.getElementById('light-ambient-color').value,
            ambientInt:   parseFloat(document.getElementById('light-ambient-intensity').value),
            sunColor:     document.getElementById('light-sun-color').value,
            sunInt:       parseFloat(document.getElementById('light-sun-intensity').value),
            hemiSky:      document.getElementById('light-hemi-sky').value,
            hemiGround:   document.getElementById('light-hemi-ground').value,
            hemiInt:      parseFloat(document.getElementById('light-hemi-intensity').value),
            skyTop:       document.getElementById('world-sky-top').value,
            skyMid:       document.getElementById('world-sky-mid').value,
            skyBottom:    document.getElementById('world-sky-bottom').value,
            groundColor:  document.getElementById('world-ground-color').value,
            groundRough:  document.getElementById('world-ground-roughness').value,
            groundMetal:  document.getElementById('world-ground-metalness').value,
            shadows:      document.getElementById('gfx-shadows').checked,
            shadowRes:    document.getElementById('gfx-shadow-res').value,
            shadowType:   document.getElementById('gfx-shadow-type').value,
            fogEnabled:   document.getElementById('gfx-fog-enabled').checked,
            fogColor:     document.getElementById('gfx-fog-color').value,
            fogNear:      document.getElementById('gfx-fog-near').value,
            fogFar:       document.getElementById('gfx-fog-far').value,
            toneMapping:  document.getElementById('gfx-tonemapping').value,
            exposure:     document.getElementById('gfx-exposure').value,
            pixelRatio:   document.getElementById('gfx-pixelratio').value
        };
        localStorage.setItem('graphicsSettings', JSON.stringify(data));
    }

    loadGraphicsSettings() {
        const raw = localStorage.getItem('graphicsSettings');
        if (!raw) return;
        try {
            const d = JSON.parse(raw);
            const $ = id => document.getElementById(id);

            $('light-ambient-color').value = d.ambientColor;
            $('light-ambient-intensity').value = d.ambientInt;
            $('light-ambient-intensity-val').textContent = d.ambientInt;

            $('light-sun-color').value = d.sunColor;
            $('light-sun-intensity').value = d.sunInt;
            $('light-sun-intensity-val').textContent = d.sunInt;

            $('light-hemi-sky').value = d.hemiSky;
            $('light-hemi-ground').value = d.hemiGround;
            $('light-hemi-intensity').value = d.hemiInt;
            $('light-hemi-intensity-val').textContent = d.hemiInt;

            $('world-sky-top').value = d.skyTop;
            $('world-sky-mid').value = d.skyMid;
            $('world-sky-bottom').value = d.skyBottom;
            $('world-ground-color').value = d.groundColor;
            $('world-ground-roughness').value = d.groundRough;
            $('world-ground-roughness-val').textContent = parseFloat(d.groundRough).toFixed(2);
            $('world-ground-metalness').value = d.groundMetal;
            $('world-ground-metalness-val').textContent = parseFloat(d.groundMetal).toFixed(2);

            $('gfx-shadows').checked = d.shadows;
            $('gfx-shadow-res').value = d.shadowRes;
            $('gfx-shadow-type').value = d.shadowType;
            $('gfx-fog-enabled').checked = d.fogEnabled;
            $('gfx-fog-color').value = d.fogColor;
            $('gfx-fog-near').value = d.fogNear;
            $('gfx-fog-far').value = d.fogFar;
            $('gfx-tonemapping').value = d.toneMapping;
            $('gfx-exposure').value = d.exposure;
            $('gfx-exposure-val').textContent = d.exposure;
            $('gfx-pixelratio').value = d.pixelRatio;

            // Применяем
            this.lighting.setAmbient(d.ambientColor, d.ambientInt);
            this.lighting.setSun(d.sunColor, d.sunInt);
            this.lighting.setHemisphere(d.hemiSky, d.hemiGround, d.hemiInt);
            this.lighting.setShadowsEnabled(d.shadows);
            this.lighting.setShadowResolution(parseInt(d.shadowRes));

            this.world.setSkyColors(d.skyTop, d.skyMid, d.skyBottom);
            this.world.setGroundColor(d.groundColor);
            this.world.setGroundRoughness(parseFloat(d.groundRough));
            this.world.setGroundMetalness(parseFloat(d.groundMetal));

            this.renderer.shadowMap.enabled = d.shadows;
            const typeMap = {
                basic: THREE.BasicShadowMap, pcf: THREE.PCFShadowMap,
                pcfsoft: THREE.PCFSoftShadowMap, vsm: THREE.VSMShadowMap
            };
            this.renderer.shadowMap.type = typeMap[d.shadowType] || THREE.PCFSoftShadowMap;

            if (d.fogEnabled) {
                this.scene.fog = new THREE.Fog(
                    parseInt(d.fogColor.replace('#',''), 16),
                    parseFloat(d.fogNear), parseFloat(d.fogFar)
                );
            } else {
                this.scene.fog = null;
            }

            const tmMap = {
                none: THREE.NoToneMapping, linear: THREE.LinearToneMapping,
                reinhard: THREE.ReinhardToneMapping, cineon: THREE.CineonToneMapping,
                aces: THREE.ACESFilmicToneMapping
            };
            this.renderer.toneMapping = tmMap[d.toneMapping] || THREE.NoToneMapping;
            this.renderer.toneMappingExposure = parseFloat(d.exposure);

            this.renderer.setPixelRatio(
                d.pixelRatio === 'auto'
                    ? Math.min(window.devicePixelRatio, 2)
                    : parseFloat(d.pixelRatio)
            );

            this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
        } catch (e) {
            console.warn('Не удалось загрузить настройки графики', e);
        }
    }

    resetGraphicsSettings() {
        localStorage.removeItem('graphicsSettings');
        location.reload();
    }
}