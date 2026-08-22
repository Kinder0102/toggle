import { HTML_CHECKBOX, HTML_RADIO } from 'js-common/js-constant'

import {
    assert,
    hasValue,
    isElement,
    isTrue,
    objectEntries,
    objectKeys,
    split,
    startsWith,
    toArray,
    toCamelCase,
    toKebabCase
} from 'js-common/js-utils'

import {
    elementIs,
    addClass,
    getTargets,
    hasClass,
    querySelector,
    registerEvent,
    registerMutationObserver,
    removeClass,
    stopDefaultEvent
} from 'js-common/js-dom-utils'

import { createInstanceMap } from 'js-common/js-cache'
import { createDatasetHelper } from 'js-common/js-dataset-helper'
import { createProperty } from 'js-common/js-dsl-factory'

const CLASS_NAME = 'toggle'
const INIT_CLASS_NAME = `${CLASS_NAME}-initialized`
const INSIDE_CLASS_NAME = `${CLASS_NAME}-inside`
const OUTSIDE_CLASS_NAME = `${CLASS_NAME}-outside`

const INPUT_SELECTOR = 'input, select, textarea, [contenteditable="true"]'
const TRIGGER_EVENT_NAME = `${CLASS_NAME}:trigger`

const SHOW_ACTION = new Set(['show', 'hide', 'toggle'])
const TYPE_HANDLERS = {
    'class': {
        hasValue: (el, name) => hasClass(el, name),
        setValue: (el, name, flag) => isTrue(flag) ? addClass(el, name) : removeClass(el, name)
    },
    attr: {
        hasValue: (el, name, values) => {
            if (Object.keys(values).length > 1) {
                return el.getAttribute(name) == values.true
            } else {
                return el.hasAttribute(name)
            }
        },
        setValue: (el, name, flag, values) => {
            const value = values[isTrue(flag)]
            el[name] = value
            hasValue(value) ? el.setAttribute(name, value) : el.removeAttribute(name)
        }
    }
}

let ACTION_HANDLERS = {
    dismiss: (target, payload) => handleElement(target, payload, 'remove'),
    focus: (target, payload) => handleElement(target, payload, 'focus'),
    clear: handleClear,
    reset: handleReset,
    filter: handleFilter,
    toggle: handleToggle,
    show: (target, payload) => handleToggle(target, payload, true),
    hide: (target, payload) => handleToggle(target, payload, false)
}

class Toggle {
    static prefix = 'tg'
    static SUPPORTED_EVENTS = ['click', 'change']
    static instance = createInstanceMap(
        el => !hasClass(el, INIT_CLASS_NAME),
        el => new Toggle(el))

    #datasetHelper = createDatasetHelper(Toggle.prefix)
    #outsideClickAbort
    #root
    #triggerProps
    #payload

    constructor(el, opt = {}) {
        assert(isElement(el), 1, 'HTMLElement')
        this.#root = el
        this.#triggerProps = this.#datasetHelper.resolveValues(el, 'trigger', opt?.trigger)
        this.#payload = {
            root: el,
            datasetHelper: this.#datasetHelper,
            type: toArray(this.#datasetHelper.getValue(el, 'type', objectKeys(TYPE_HANDLERS))),
            ignore: new Set(split(this.#datasetHelper.getValue(el, 'ignore'))),
            attr: this.#datasetHelper.resolveValues(el, 'attr')
        }

        for (const [eventName, value] of objectEntries(this.#triggerProps)) {
            const props = createProperty(value)
            this.#triggerProps[eventName] = props
            registerEvent(el, [eventName, TRIGGER_EVENT_NAME], event => this.#run(props))
        }

        el.style.cursor = 'pointer'
        el.style.userSelect = 'none'
        addClass(el, INIT_CLASS_NAME)

        if (el.hasAttribute(this.#datasetHelper.keyToAttrName('open'))) {
            const isOpen = this.#datasetHelper.getValue(el, 'open')
            if (isTrue(isOpen) || !hasValue(isOpen))
                Toggle.SUPPORTED_EVENTS.forEach(name => this.#run(this.#triggerProps[name], ['clear']))
        }
    }

    #run(props, skip = []) {
        const showTarget = []
        for (const [action, target] of objectEntries(props)) {
            if (skip.includes(action))
                continue

            let payload = this.#payload
            const selectItem = payload.root?.selectedOptions?.[0]
            if (isElement(selectItem)) {
                const attr = payload.datasetHelper.resolveValues(selectItem, 'attr')
                payload = { ...payload, attr }
            }

            ACTION_HANDLERS[action]?.(target, payload)
            if (SHOW_ACTION.has(action))
                showTarget.push(...target)
        }

        const outsideClickKey = this.#datasetHelper.keyToAttrName('outside-click')
        if (this.#root.hasAttribute(outsideClickKey)) {
            this.#outsideClickAbort?.abort()
            this.#outsideClickAbort = new AbortController()
            const inside = getTargets(showTarget.flat(), this.#root)
            inside.push(...inside.flatMap(el => toArray(el.children)), this.#root)

            const outsideClick = ({ target }) => {
                let isInside = hasClass(target, INSIDE_CLASS_NAME)
                    || (!hasClass(target, OUTSIDE_CLASS_NAME) && inside.some(el => el.contains(target)))
                if (!isInside) {
                    ACTION_HANDLERS.hide?.(showTarget, this.#payload)
                    document.removeEventListener('click', outsideClick, true)
                }
            }
            document.addEventListener('click', outsideClick, {
                capture: true,
                signal: this.#outsideClickAbort.signal
            })
        }
    }
}

function handleElement(target, { root }, methodName) {
    getTargets(target, root).forEach(el => el[methodName]())
}

function handleClear(target, { root }) {
    getTargets(target, root).forEach(el => {
        querySelector(INPUT_SELECTOR, el, true).forEach(input => {
            switch (input.type) {
                case 'checkbox':
                case 'radio':
                    input.checked = false
                    break
                case 'select-one':
                case 'select-multiple':
                    input.selectedIndex = -1
                    break;
                default:
                    if (input.matches('[contenteditable="true"]')) {
                        input.textContent = ''
                    } else {
                        input.value = ''
                    }
            }
        })
    })
}

function handleReset(target, { root }) {
    getTargets(target, root).forEach(el => {
        querySelector(INPUT_SELECTOR, el, true).forEach(input => {
            switch (input.type) {
                case 'checkbox':
                case 'radio':
                    input.checked = checkbox.defaultChecked;
                    break
                case 'select-one':
                case 'select-multiple':
                    Array.from(input.options).forEach(option => (option.selected = option.defaultSelected));
                    break;
                default:
                    const value = input.defaultValue || input.dataset.originalValue || ''
                    if (input.matches('[contenteditable="true"]')) {
                        input.textContent = value
                    } else {
                        input.value = value
                    }
            }
        })
    })
}

function handleFilter(target, payload) {
    const { root, datasetHelper } = payload
    if (elementIs(root, [HTML_CHECKBOX, HTML_RADIO]) && !root.checked)
        return

    const value = root.value || root.querySelector('input,select,textarea,[value]')?.value
    getTargets(target, root).forEach(el => {
        const props = createProperty(datasetHelper.getValue(el, 'filter'))
        handleToggle(el, payload, props.value.includes(value))
    })
}

function handleToggle(target, payload, flag) {
    const { root, type, datasetHelper } = payload
    const updatedPayload = { ...payload, flag }
    const withChildKey = datasetHelper.keyToAttrName('with-child')
    const withChildSelector = objectKeys(TYPE_HANDLERS)
        .map(name => `[${datasetHelper.keyToAttrName(name)}]`)
        .join(',')

    getTargets(target, root).forEach(el => {
        const needLockScreen = el.hasAttribute(datasetHelper.keyToAttrName('lockscreen'))
        const isShow = type.map(value => toggle(value, el, updatedPayload)).some(Boolean)
        needLockScreen && lockScreen(isShow)
        if (el.hasAttribute(withChildKey)) {
            querySelector(withChildSelector, el)
                .forEach(child => type.map(value => toggle(value, child, updatedPayload)))
        }
    })
}

function toggle(type, el, payload) {
    const { datasetHelper, attr, flag, ignore } = payload
    const isAttr = type === 'attr'
    const typeHandler = TYPE_HANDLERS[type]
    const props = createProperty(datasetHelper.resolveValues(el, type)[type])

    const settings = {
        [false]: [...props.value, ...toArray(props.add)],
        [true]: toArray(props.remove)
    }

    let hasAllValue = true
    const result = []
    for (const [negative, tokens] of objectEntries(settings)) {
        for (const name of tokens) {
            if (ignore?.has(name)) continue

            const values = isAttr ? generateAttrValue(attr, el, name, datasetHelper) : {}
            result.push({ name, values, negative })
            hasAllValue &&= isTrue(negative) ^ typeHandler.hasValue(el, name, values)
        }
    }

    const isShow = hasValue(flag) ? isTrue(flag) : !hasAllValue
    for (const { name, values, negative } of result)
        typeHandler.setValue(el, name, isTrue(negative) ^ isShow, values)
    return isShow
}

function generateAttrValue(rootAttr, el, name, datasetHelper) {
    const camelName = toCamelCase(name)
    const attrValues = { ...datasetHelper.resolveValues(el, 'attr'), ...rootAttr }
    const props = createProperty(attrValues[camelName])
    let result = objectEntries(props).reduce((acc, [key, [value]]) => {
        if (hasValue(value)) acc[key] = value
        return acc
    }, {})

    for (const [key, value] of objectEntries(attrValues)) {
        const isStartWith = startsWith(key, camelName)
        if (isStartWith.exist)
            result[toKebabCase(isStartWith.value)] = value
    }
    if (Object.keys(result).length === 0)
        result.true = true
    return result
}

function lockScreen(flag) {
    const { style } = document.documentElement
    const isLockScreen = hasValue(flag) ? isTrue(flag) : style.overflow != 'hidden'
    style.overflow = isLockScreen ? 'hidden' : null
}

export default Toggle
globalThis && (globalThis.Toggle = Toggle)

globalThis.addEventListener('DOMContentLoaded', event => {
    const datasetHelper = createDatasetHelper(Toggle.prefix)
    const selector = Toggle.SUPPORTED_EVENTS
        .map(name => datasetHelper.keyToAttrName(`trigger-${name}`))
        .map(value => `[${value}]`)
        .join(',')


    querySelector(selector).forEach(el => Toggle.instance.create(el))
    registerMutationObserver(el => {
        if (!isElement(el))
            return
        querySelector(selector, el, true).forEach(el => Toggle.instance.create(el))
    })
}, { once: true })
