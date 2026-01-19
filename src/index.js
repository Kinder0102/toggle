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
            hasValue(value) ? el.setAttribute(name, value) : el.removeAttribute(name)
        }
    }
}

let ACTION_HANDLERS = {
    dismiss: (target, payload) => handleElement(target, payload, 'remove'),
    focus: (target, payload) => handleElement(target, payload, 'focus'),
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
            const props = createProperty(value)[0]
            this.#triggerProps[eventName] = props
            registerEvent(el, eventName, event => {
                stopDefaultEvent(event)
                this.#run(props)
            })
        }

        el.style.cursor = 'pointer'
        el.style.userSelect = 'none'
        addClass(el, INIT_CLASS_NAME)

        if (isTrue(this.#datasetHelper.getValue(el, 'open'))) {
            Toggle.SUPPORTED_EVENTS.forEach(name => this.#run(this.#triggerProps[name]))
        }
    }

    #run(props) {
        const showTarget = []
        for (const [action, target] of objectEntries(props)) {
            ACTION_HANDLERS[action]?.(target, this.#payload)
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

function handleFilter(target, payload) {
    const { root, datasetHelper } = payload
    getTargets(target, root).forEach(el => {
        const props = createProperty(datasetHelper.getValue(el, 'filter'))[0]
        handleToggle(el, payload, props.value.includes(root.value))
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
    const props = createProperty(datasetHelper.resolveValues(el, type)[type])[0]

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
    const props = createProperty(attrValues[camelName])[0]
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
