import * as THREE from 'three';

export class PropertiesPanel {
    constructor() {
        this.panel = document.getElementById('inspector');
        this.title = document.getElementById('insp-title');
        this.body  = document.querySelector('.insp-body');
        this.colorInput = document.getElementById('insp-color');

        this.current = null;
        this.onChange = null;
        this.onDelete = null;
        this.onDuplicate = null;
        this.onClose = null;

        this._inputs = {
            position: this._rowInputs('position'),
            rotation: this._rowInputs('rotation'),
            scale:    this._rowInputs('scale')
        };

        this._bind();
        this.setTarget(null);
    }

    _rowInputs(prop) {
        const row = this.panel.querySelector(`.insp-row[data-prop="${prop}"]`);
        return {
            x: row.querySelector('input[data-axis="x"]'),
            y: row.querySelector('input[data-axis="y"]'),
            z: row.querySelector('input[data-axis="z"]')
        };
    }

    _bind() {
        // Числовые поля
        for (const prop of ['position', 'rotation', 'scale']) {
            for (const axis of ['x', 'y', 'z']) {
                const input = this._inputs[prop][axis];
                input.addEventListener('input', () => {
                    if (!this.current) return;
                    const val = parseFloat(input.value);
                    if (isNaN(val)) return;

                    if (prop === 'position') {
                        this.current.position[axis] = val;
                    } else if (prop === 'scale') {
                        const v = Math.max(0.01, val);
                        this.current.scale[axis] = v;
                    } else if (prop === 'rotation') {
                        // В UI — градусы, в Three.js — радианы
                        this.current.rotation[axis] = THREE.MathUtils.degToRad(val);
                    }

                    if (this.onChange) this.onChange(this.current);
                });

                // Запрещаем проброс клавиш в редактор (Delete, R, G, S и т.п.),
                // пока фокус в поле ввода
                input.addEventListener('keydown', e => {
                    e.stopPropagation();
                    if (e.code === 'Enter') input.blur();
                });
            }
        }

        // Цвет
        this.colorInput.addEventListener('input', () => {
            if (!this.current || !this.current.material) return;
            this.current.material.color.set(this.colorInput.value);
            if (this.onChange) this.onChange(this.current);
        });

        // Кнопки
        document.getElementById('insp-delete').addEventListener('click', () => {
            if (this.onDelete) this.onDelete();
        });
        document.getElementById('insp-duplicate').addEventListener('click', () => {
            if (this.onDuplicate) this.onDuplicate();
        });
        document.getElementById('insp-close').addEventListener('click', () => {
            if (this.onClose) this.onClose();
        });
    }

    setTarget(obj) {
        this.current = obj;

        if (!obj) {
            this.title.textContent = 'Ничего не выбрано';
            this.body.classList.add('disabled');
            return;
        }

        this.body.classList.remove('disabled');
        this.title.textContent = obj.userData.name || obj.geometry?.type || 'Объект';

        this.syncFrom(obj);
    }

    syncFrom(obj) {
        if (!obj || obj !== this.current) return;

        // Позиция
        this._inputs.position.x.value = obj.position.x.toFixed(3);
        this._inputs.position.y.value = obj.position.y.toFixed(3);
        this._inputs.position.z.value = obj.position.z.toFixed(3);

        // Поворот (в градусах)
        this._inputs.rotation.x.value = THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1);
        this._inputs.rotation.y.value = THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1);
        this._inputs.rotation.z.value = THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1);

        // Масштаб
        this._inputs.scale.x.value = obj.scale.x.toFixed(3);
        this._inputs.scale.y.value = obj.scale.y.toFixed(3);
        this._inputs.scale.z.value = obj.scale.z.toFixed(3);

        // Цвет
        if (obj.material && obj.material.color) {
            this.colorInput.value = '#' + obj.material.color.getHexString();
        }
    }
}