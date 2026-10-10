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
    constructor(scene, camera, player, world, domElement) {
        this.scene = scene;
        this.camera = camera;
        this.player = player;
        this.world = world;
        this.dom = domElement;

        this.active = false;

        // Список выделенных объектов
        this.selection = [];

        // "Призрак" — будущий объект, который ставим кликом
        this.pendingType = null;   // 'box' | 'sphere' | ... | null
        this.pendingGhost = null;

        this.defaultMaterial = new THREE.MeshStandardMaterial({
            color: 0xcc8844,
            roughness: 0.7,
            metalness: 0.1
        });

        // Подсветка выделенных объектов
        this.selectionBoxes = new THREE.Group();
        this.selectionBoxes.renderOrder = 998;
        this.scene.add(this.selectionBoxes);

        // Камера редактора
		console.log('[Editor] args:', { scene, camera, player, world, domElement });
		this.editorCamera = new EditorCamera(camera, domElement);

        this.editorCamera.enabled = false;

        // Гизмо
        this.gizmo = new Gizmo(scene, camera, domElement);
		this._initSnapUI();
        this.gizmo.enabled = false;
        this.gizmo.onChange = (obj) => {
            this.properties.syncFrom(obj);
            this._updateSelectionBoxes();
        };

        // Панель свойств
        this.properties = new PropertiesPanel();
        this.properties.onChange = (obj) => {
            this.gizmo.sync();
            this._updateSelectionBoxes();
        };
        this.properties.onDelete = () => this.deleteSelected();
        this.properties.onDuplicate = () => this.duplicateSelected();
        this.properties.onClose = () => this.deselectAll();

        // Рейкастер для выбора объектов
        this._raycaster = new THREE.Raycaster();

        // Плоскость "земли" для пикинга пустого места
        this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

        this._bind();
    }

    // ============ Публичное API ============

    toggle() {
        this.active = !this.active;

        document.getElementById('mode').textContent = this.active ? 'Редактор' : 'Игра';
        document.body.classList.toggle('editor-mode', this.active);

        if (this.active) {
            // Отпускаем захват мыши у игрока
            this.player.unlock();

            // Включаем редакторную камеру в текущей позиции
            this.editorCamera.enabled = true;
            // Ставим target на сцену впереди игрока
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

        // Камера редактора сама обновляется в обработчиках мыши,
        // но при движении цели (например, панорама) — sync не нужен,
        // EditorCamera.update() вызывается внутри обработчиков.
        this.editorCamera.update();

        // Гизмо всегда смотрит на цель и масштабируется от дистанции
        if (this.selection.length > 0) {
            this.gizmo.sync();
        }

        // Призрак следует за курсором
        this._updatePendingGhost();
    }

    // ============ Ввод ============

    _bind() {
        // Клавиатура
        window.addEventListener('keydown', e => {
            // TAB — переключение режима
            if (e.code === 'Tab') {
                e.preventDefault();
                this.toggle();
                return;
            }
            if (!this.active) return;

            // Delete / Backspace — удалить выделенное
            if (e.code === 'Delete' || e.code === 'Backspace') {
                e.preventDefault();
                this.deleteSelected();
                return;
            }

            // Escape — отменить все активные действия
            if (e.code === 'Escape') {
                this._cancelPending();
                this.deselectAll();
                return;
            }

            // Выбор примитива для добавления
            const primMap = {
                Digit1: 'box', Digit2: 'sphere', Digit3: 'cylinder',
                Digit4: 'cone', Digit5: 'torus', Digit6: 'plane'
            };
            if (primMap[e.code]) {
                this._startPending(primMap[e.code]);
                this._updatePaletteUI();
                return;
            }

            // Режимы гизмо
            if (e.code === 'KeyG') this._setGizmoMode('translate');
            if (e.code === 'KeyR') this._setGizmoMode('rotate');
            if (e.code === 'KeyS') this._setGizmoMode('scale');

            // Дублировать
            if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.duplicateSelected();
            }

            // Фокус на выделенном
            if (e.code === 'KeyF') {
                this._focusSelection();
            }
        });

        // Клик по палитре
        document.querySelectorAll('.slot').forEach(slot => {
            slot.addEventListener('click', () => {
                this._startPending(slot.dataset.type);
                this._updatePaletteUI();
            });
        });

        // Мышь: клик по сцене
        this.dom.addEventListener('mousedown', e => this._onMouseDown(e));
        this.dom.addEventListener('mouseup',   e => this._onMouseUp(e));
        this.dom.addEventListener('mousemove', e => this._onMouseMove(e));

        // Отключаем контекстное меню
        this.dom.addEventListener('contextmenu', e => e.preventDefault());
    }

    _mouseNdc(e) {
        const rect = this.dom.getBoundingClientRect();
        return {
            x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
            y: -((e.clientY - rect.top) / rect.height) * 2 + 1
        };
    }

    // Запоминаем, что мышь была нажата именно на пустом месте — чтобы отличить
    // клик-выбор от drag-камеры
    _onMouseDown(e) {
        if (!this.active) return;
        this._downPos = { x: e.clientX, y: e.clientY, button: e.button };
    }

    _onMouseUp(e) {
        if (!this.active) return;
        if (!this._downPos) return;

        // Считаем drag-расстояние
        const dx = e.clientX - this._downPos.x;
        const dy = e.clientY - this._downPos.y;
        const dragDist = Math.hypot(dx, dy);

        const wasLeftClick = e.button === 0;
        const wasRightClick = e.button === 2;

        this._downPos = null;

        // ПКМ или перетаскивание — не выбор
        if (wasRightClick) return;
        if (dragDist > 4) return;

        if (wasLeftClick) {
            this._handleLeftClick(e);
        }
    }

    _onMouseMove(e) {
        // Здесь EditorCamera уже обрабатывает свои drag-жесты.
        // Мы только обновляем призрак, если он активен.
        if (!this.active) return;
        if (this.pendingGhost) {
            this._updatePendingGhost();
        }
    }

    // ============ Логика клика ============

    _handleLeftClick(e) {
        const ndc = this._mouseNdc(e);

        // 1) Пик по редактируемым объектам
        this._raycaster.setFromCamera(ndc, this.camera);
        const hits = this._raycaster.intersectObjects(this.world.editableObjects, false);
        const objHit = hits[0];

        // 2) Режим "поставить примитив"
        if (this.pendingType) {
            this._placePending(objHit);
            // после создания — выходим из pending, но оставляем примитив выбранным
            this._cancelPending();
            this._updatePaletteUI();
            return;
        }

        // 3) Обычный режим — выделение
        if (objHit) {
            const multi = e.shiftKey;
            this.select(objHit.object, multi);
        } else {
            // клик по пустому месту — снять выделение
            if (!e.shiftKey) this.deselectAll();
        }
    }

    // ============ Выделение ============

    select(obj, additive = false) {
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
        } else if (this.selection.length === 1) {
            this.gizmo.setTarget(this.selection[0]);
            this.properties.setTarget(this.selection[0]);
        } else {
            // Мультивыделение — гизмо по центру группы, но редактируем по одному.
            // Для простоты: гизмо цепляем на последний, инспектор — на последний.
            const last = this.selection[this.selection.length - 1];
            this.gizmo.setTarget(last);
            this.properties.setTarget(last);
        }
        this._updateSelectionBoxes();
    }

    _applySelectionVisual() {
        // Снимаем старые боксы
        while (this.selectionBoxes.children.length > 0) {
            const c = this.selectionBoxes.children.pop();
            c.geometry?.dispose();
            c.material?.dispose();
        }
        // Рисуем новые
        for (const obj of this.selection) {
            const box = new THREE.Box3().setFromObject(obj);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const helper = new THREE.Mesh(
                new THREE.BoxGeometry(size.x, size.y, size.z),
                new THREE.MeshBasicMaterial({
                    color: 0xffd86b, wireframe: true,
                    transparent: true, opacity: 0.5,
                    depthTest: false
                })
            );
            helper.position.copy(center);
            helper.renderOrder = 998;
            this.selectionBoxes.add(helper);
        }
    }

    _updateSelectionBoxes() {
        if (this.selection.length === 0) return;
        // пере-раскидываем боксы по текущим позициям (после гизмо/инспектора)
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

        // Луч из мыши
        const ndc = this._lastMouseNdc || { x: 0, y: 0 };
        this._raycaster.setFromCamera(ndc, this.camera);
        const hits = this._raycaster.intersectObjects(this.world.editableObjects, false);

        let pos = null;
        if (hits[0]) {
            const p = hits[0].point.clone();
            const n = hits[0].face.normal.clone()
                .transformDirection(hits[0].object.matrixWorld);
            p.addScaledVector(n, 0.5);
            pos = p;
        } else {
            // Плоскость Y=0
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

        // Позиция
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
            if (!hit) return; // мимо — ничего не создаём
            point.y = 0.5;
            mesh.position.copy(point);
        }

        // Плоскость разворачиваем, чтобы смотрела вверх
        if (type === 'plane') {
            mesh.rotation.x = -Math.PI / 2;
        }
		
		// Snap к сетке, если включено
		if (this.gizmo.snapEnabled && this.gizmo.snapSize > 0) {
			const s = this.gizmo.snapSize;
			mesh.position.x = Math.round(mesh.position.x / s) * s;
			mesh.position.y = Math.max(s / 2, Math.round(mesh.position.y / s) * s);
			mesh.position.z = Math.round(mesh.position.z / s) * s;
		}

        this.world.add(mesh);

        // Сразу выделяем новый объект
        this.select(mesh, false);
    }

    // ============ Действия ============

    deleteSelected() {
        const toDelete = [...this.selection];
        this.deselectAll();
        for (const obj of toDelete) {
            this.world.remove(obj);
            obj.geometry?.dispose();
            obj.material?.dispose();
        }
    }

    duplicateSelected() {
        const copies = [];
        for (const obj of this.selection) {
            const copy = obj.clone();
            copy.material = obj.material.clone();
            copy.position.x += 1;
            copy.position.z += 1;
            this.world.add(copy);
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
        // Центр выделенных
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

		// Не пробрасывать клавиши в редактор, пока фокус в поле
		size.addEventListener('keydown', e => e.stopPropagation());

		apply();
	}
}