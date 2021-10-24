// All functions that need access to the editor's state live inside
// the CodeMirror function. Below that, at the bottom of the file,
// some utilities are defined.

// The history object 'chunks' changes that are made close together
// and at almost the same time into bigger undoable units.
class History {
    constructor() {
        this.time = 0
        this.done = []
        this.undone = []
    }
    addChange(start, added, old) {
        this.undone.length = 0
        var time = + new Date
        var last = this.done[this.done.length - 1]
        if (time - this.time > 400 || !last || last.start > start + added || last.start + last.added < start - last.added + last.old.length) {
            this.done.push({ start: start, added: added, old: old })
        } else {
            var oldoff = 0
            if (start < last.start) {
                for (var i = last.start - start - 1; i >= 0; --i) {
                    last.old.unshift(old[i])
                }
                last.added += last.start - start
                last.start = start
            } else if (last.start < start) {
                oldoff = start - last.start
                added += oldoff
            }
            for (var i = last.added - oldoff, e = old.length; i < e; ++i) {
                last.old.push(old[i])
            }
            if (last.added < added) {
                last.added = added
            }
        }
        this.time = time
    }
}

// Line objects. These hold state related to a line, including
// highlighting info (the styles array).
class Line {
    constructor(text, styles) {
        this.styles = styles || [text, null]
        this.stateAfter = null
        this.text = text
        this.marked = this.gutterMarker = this.className = null
    }
    // Replace a piece of a line, keeping the styles around it intact.
    replace(from, to, text) {
        var st = []
        var mk = this.marked
        copyStyles(0, from, this.styles, st)
        if (text) {
            st.push(text, null)
        }
        copyStyles(to, this.text.length, this.styles, st)
        this.styles = st
        this.text = this.text.slice(0, from) + text + this.text.slice(to)
        this.stateAfter = null
        if (mk) {
            var diff = text.length - (to - from)
            var end = this.text.length
            function fix(n) {
                return n <= Math.min(to, to + diff) ? n : n + diff
            }
            for (var i = 0; i < mk.length; ++i) {
                var mark = mk[i]
                var del = false
                if (mark.from >= end) {
                    del = true
                } else {
                    mark.from = fix(mark.from)
                    if (mark.to != null) {
                        mark.to = fix(mark.to)
                    }
                }
                if (del || mark.from >= mark.to) {
                    mk.splice(i, 1); i--
                }
            }
        }
    }
    // Split a line in two, again keeping styles intact.
    split(pos, textBefore) {
        var st = [textBefore, null]
        copyStyles(pos, this.text.length, this.styles, st)
        return new Line(textBefore + this.text.slice(pos), st)
    }
    addMark(from, to, style) {
        var mk = this.marked
        var mark = {
            from: from,
            to: to,
            style: style
        }
        if (this.marked == null) {
            this.marked = []
        }
        this.marked.push(mark)
        this.marked.sort(function (a, b) { return a.from - b.from })
        return mark
    }
    removeMark(mark) {
        var mk = this.marked
        if (!mk) return
        for (var i = 0; i < mk.length; ++i) {
            if (mk[i] == mark) {
                mk.splice(i, 1)
                break
            }
        }
    }
    // Run the given mode's parser over a line, update the styles
    // array, which contains alternating fragments of text and CSS
    // classes.
    highlight(mode, state) {
        var stream = new StringStream(this.text)
        var st = this.styles
        var pos = 0
        var changed = false
        while (!stream.eol()) {
            var style = mode.token(stream, state)
            var substr = this.text.slice(stream.start, stream.pos)
            stream.start = stream.pos
            if (pos && st[pos - 1] == style) {
                st[pos - 2] += substr
            } else if (substr) {
                if (!changed && st[pos] != substr || st[pos + 1] != style) {
                    changed = true
                }
                st[pos++] = substr
                st[pos++] = style
            }
            // Give up when line is ridiculously long
            if (stream.pos > 5000) {
                st[pos++] = this.text.slice(stream.pos)
                st[pos++] = null
                break
            }
        }
        if (st.length != pos) {
            st.length = pos
            changed = true
        }
        return changed
    }
    indentation() {
        return countColumn(this.text)
    }
    // Produces an HTML fragment for the line, taking selection,
    // marking, and highlighting into account.
    getHTML(sfrom, sto, includePre) {
        var html = []
        if (includePre) {
            html.push(this.className ? '<pre class="' + this.className + '">' : '<pre>')
        }
        function span(text, style) {
            if (!text) {
                return
            }
            if (style) {
                html.push('<span class="', style, '">', htmlEscape(text), '</span>')
            } else {
                html.push(htmlEscape(text))
            }
        }
        var st = this.styles
        var allText = this.text
        var marked = this.marked
        if (sfrom == sto) {
            sfrom = null
        }

        if (!allText) {
            span(' ', sfrom != null && sto == null ? 'XliffEditor-selected' : null)
        } else if (!marked && sfrom == null) {
            for (var i = 0, e = st.length; i < e; i += 2) {
                span(st[i], st[i + 1])
            }
        } else {
            var pos = 0
            var i = 0
            var text = ''
            var style
            var sg = 0
            var markpos = -1
            var mark = null
            function nextMark() {
                if (marked) {
                    markpos += 1
                    mark = (markpos < marked.length) ? marked[markpos] : null
                }
            }
            nextMark()
            while (pos < allText.length) {
                var upto = allText.length
                var extraStyle = ''
                if (sfrom != null) {
                    if (sfrom > pos) {
                        upto = sfrom
                    } else if (sto == null || sto > pos) {
                        extraStyle = ' XliffEditor-selected'
                        if (sto != null) {
                            upto = Math.min(upto, sto)
                        }
                    }
                }
                while (mark && mark.to != null && mark.to <= pos) {
                    nextMark()
                }
                if (mark) {
                    if (mark.from > pos) {
                        upto = Math.min(upto, mark.from)
                    } else {
                        extraStyle += ' ' + mark.style
                        if (mark.to != null) {
                            upto = Math.min(upto, mark.to)
                        }
                    }
                }
                for (; ;) {
                    var end = pos + text.length
                    var apliedStyle = style
                    if (extraStyle) {
                        apliedStyle = style ? style + extraStyle : extraStyle
                    }
                    span(end > upto ? text.slice(0, upto - pos) : text, apliedStyle)
                    if (end >= upto) {
                        text = text.slice(upto - pos)
                        pos = upto
                        break
                    }
                    pos = end
                    text = st[i++]
                    style = st[i++]
                }
            }
            if (sfrom != null && sto == null) {
                span(' ', 'XliffEditor-selected')
            }
        }
        if (includePre) {
            html.push('</pre>')
        }
        return html.join('')
    }
}

class Delayed {
    constructor() {
        this.id = null
    }
    set(ms, f) {
        clearTimeout(this.id)
        this.id = setTimeout(f, ms)
    }
}

function stopEvent() {
    if (this.preventDefault) {
        this.preventDefault()
        this.stopPropagation()
    } else {
        this.returnValue = false
        this.cancelBubble = true
    }
}

function copyStyles(from, to, source, dest) {
    for (var i = 0, pos = 0, state = 0; pos < to; i += 2) {
        var part = source[i]
        var end = pos + part.length
        if (state == 0) {
            if (end > from) {
                dest.push(part.slice(from - pos, Math.min(part.length, to - pos)), source[i + 1])
            }
            if (end >= from) {
                state = 1
            }
        } else if (state == 1) {
            if (end > to) {
                dest.push(part.slice(0, to - pos), source[i + 1])
            } else {
                dest.push(part, source[i + 1])
            }
        }
        pos = end
    }
}

function addStop(event) {
    if (!event.stop) {
        event.stop = stopEvent
    }
    return event
}

function htmlEscape(str) {
    return str.replace(/[<&]/g, function (str) { return str == '&' ? '&amp;' : '&lt;'; })
}
function countColumn(string, end) {
    if (end == null) {
        end = string.search(/[^\s\u00a0]/)
        if (end == -1) {
            end = string.length
        }
    }
    for (var i = 0, n = 0; i < end; ++i) {
        if (string.charAt(i) == "\t") {
            n += tabSize - (n % tabSize)
        } else {
            ++n
        }
    }
    return n
}
class Event {
    constructor(orig) {
        this.e = orig
    }
    stop() {
        stopEvent.call(this.e)
    }
    target() {
        return this.e.target || this.e.srcElement
    }
    button() {
        if (this.e.which) {
            return this.e.which
        } else if (this.e.button & 1) {
            return 1
        } else if (this.e.button & 2) {
            return 3
        } else if (this.e.button & 4) {
            return 2
        }
    }
    pageX() {
        if (this.e.pageX != null) {
            return this.e.pageX
        } else {
            return this.e.clientX + document.body.scrollLeft + document.documentElement.scrollLeft
        }
    }
    pageY() {
        if (this.e.pageY != null) {
            return this.e.pageY
        } else {
            return this.e.clientY + document.body.scrollTop + document.documentElement.scrollTop
        }
    }
}

class StringStream {
    constructor(string) {
        this.pos = this.start = 0
        this.string = string
    }
    eol() {
        return this.pos >= this.string.length
    }
    sol() {
        return this.pos == 0
    }
    peek() {
        return this.string.charAt(this.pos)
    }
    next() {
        if (this.pos < this.string.length) {
            return this.string.charAt(this.pos++)
        }
    }
    eat(match) {
        var ch = this.string.charAt(this.pos)
        if (typeof match == 'string') {
            var ok = ch == match
        } else {
            var ok = ch && (match.test ? match.test(ch) : match(ch))
        }
        if (ok) {
            ++this.pos
            return ch
        }
    }
    eatWhile(match) {
        var start = this.start
        while (this.eat(match)) { }
        return this.pos > start
    }
    eatSpace() {
        var start = this.pos
        while (/[\s\u00a0]/.test(this.string.charAt(this.pos))) {
            ++this.pos
        }
        return this.pos > start
    }
    skipToEnd() {
        this.pos = this.string.length
    }
    skipTo(ch) {
        var found = this.string.indexOf(ch, this.pos)
        if (found > -1) {
            this.pos = found
            return true
        }
    }
    backUp(n) {
        this.pos -= n
    }
    column() {
        return countColumn(this.string, this.start)
    }
    indentation() {
        return countColumn(this.string)
    }
    match(pattern, consume, caseInsensitive) {
        if (typeof pattern == 'string') {
            function cased(str) {
                return caseInsensitive ? str.toLowerCase() : str
            }
            if (cased(this.string).indexOf(cased(pattern), this.pos) == this.pos) {
                if (consume !== false) {
                    this.pos += pattern.length
                }
                return true
            }
        } else {
            var match = this.string.slice(this.pos).match(pattern)
            if (match && consume !== false) {
                this.pos += match[0].length
            }
            return match
        }
    }
    current() {
        return this.string.slice(this.start, this.pos)
    }
}

class Segment {
    constructor(lines) {
        this.source = lines
        this.target = []
    }
    getHTML(sfrom, sto, includePre) {
        return '<div><div>source</div><div>target</div></div>'
    }
}

class XliffEditor {
    constructor(place, givenOptions) {
        //#region Prepare Defaults
        const options = {
            value: '',
            mode: null,
            indentUnit: 2,
            indentWithTabs: false,
            tabMode: 'classic',
            enterMode: 'indent',
            electricChars: true,
            onKeyEvent: null,
            lineNumbers: true,
            gutter: false,
            firstLineNumber: 1,
            readOnly: false,
            onChange: null,
            onCursorActivity: null,
            onGutterClick: null,
            onFocus: null,
            onBlur: null,
            onScroll: null,
            matchBrackets: false,
            workTime: 100,
            workDelay: 200,
            undoDepth: 40,
            tabindex: null
        }

        for (var opt in options) {
            if (givenOptions.hasOwnProperty(opt)) {
                options[opt] = givenOptions[opt]
            }
        }
        //#endregion

        //#region Prepare DOM
        const wrapper = place
        wrapper.className = 'XliffEditor'

        const code = document.createElement('div')
        code.style.position = 'relative'
        wrapper.appendChild(code)

        const measure = document.createElement('pre')
        measure.style.position = 'relative'
        measure.style.height = 0
        measure.style.visibility = 'hidden'
        measure.style.overflow = 'hidden'
        code.appendChild(measure)

        const measureSpan = document.createElement('span')
        measureSpan.innerText = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
        measure.appendChild(measureSpan)

        const mover = document.createElement('div')
        mover.style.position = 'relative'
        code.appendChild(mover)

        const gutter = document.createElement('div')
        gutter.className = 'XliffEditor-gutter'
        mover.appendChild(gutter)

        const gutterText = document.createElement('div')
        gutterText.className = 'XliffEditor-gutter-text'
        gutter.appendChild(gutterText)

        const inputDiv = document.createElement('div')
        inputDiv.style.overflow = 'hidden'
        inputDiv.style.position = 'absolute'
        inputDiv.style.width = 0
        inputDiv.style.left = 0
        mover.appendChild(inputDiv)

        const input = document.createElement('textarea')
        input.style.height = '1px'
        input.style.position = 'absolute'
        input.style.width = '1px'
        input.wrap = 'off'
        inputDiv.appendChild(input)

        const editorLines = document.createElement('div')
        editorLines.className = 'XliffEditor-lines'
        mover.appendChild(editorLines)

        const lineSpace = document.createElement('div')
        lineSpace.style.position = 'relative'
        editorLines.appendChild(lineSpace)

        const cursor = document.createElement('pre')
        cursor.className = 'XliffEditor-cursor'
        cursor.innerHTML = '&#160;'
        lineSpace.appendChild(cursor)

        const lineDiv = document.createElement('div')
        lineSpace.appendChild(lineDiv)

        if (options.tabindex != null) {
            input.tabindex = options.tabindex
        }
        if (!options.gutter && !options.lineNumbers) {
            gutter.style.display = 'none'
        }
        //#endregion

        //#region Helper functions
        var modes = {}
        var mimeModes = {}
        const defineMode = (name, mode) => {
            if (!options.mode && name != 'null') {
                options.mode = name
            }
            modes[name] = mode
        }
        const defineMIME = (mime, spec) => {
            mimeModes[mime] = spec
        }
        const getMode = (options, spec) => {
            if (typeof spec == 'string' && mimeModes.hasOwnProperty(spec)) {
                spec = mimeModes[spec]
            }
            if (typeof spec == 'string') {
                var mname = spec
                var config = {}
            } else {
                var mname = spec.name
                var config = spec
            }
            var mfactory = modes[mname]
            if (!mfactory) {
                if (window.console) console.warn('No mode ' + mname + ' found, falling back to plain text.')
                return getMode(options, 'text/plain')
            }
            return mfactory(options, config)
        }
        const listModes = () => modes.filter(m => modes.propertyIsEnumerable(m))
        const listMIMEs = () => mimeModes.filter(m => mimeModes.propertyIsEnumerable(m))
        const connect = (node, type, handler, disconnect) => {
            const wrapHandler = event => handler(new Event(event || window.event))

            node.addEventListener(type, wrapHandler, false)
            if (disconnect) return () => node.removeEventListener(type, wrapHandler, false)
        }
        var splitLines
        if ('\n\nb'.split(/\n/).length != 3) {
            splitLines = string => {
                var pos = 0
                var nl
                var result = []
                while ((nl = string.indexOf("\n", pos)) > -1) {
                    result.push(string.slice(pos, string.charAt(nl - 1) == "\r" ? nl - 1 : nl))
                    pos = nl + 1
                }
                result.push(string.slice(pos))
                return result
            }
        } else {
            splitLines = string => string.split(/\r?\n/)
        }
        const loadMode = () => {
            mode = getMode(options, options.mode)
            for (var i = 0, l = lines.length; i < l; ++i) {
                lines[i].stateAfter = null
            }
            work = [0]
        }
        const copyState = (mode, state) => {
            if (state === true) return state
            if (mode.copyState) return mode.copyState(state)
            var nstate = {}
            for (var n in state) {
                var val = state[n]
                if (val instanceof Array) {
                    val = val.concat([])
                }
                nstate[n] = val
            }
            return nstate
        }
        //#endregion

        //#region Define Mode
        defineMode('css', config => {
            var indentUnit = config.indentUnit, type
            const ret = (style, tp) => {
                type = tp
                return style
            }

            const tokenBase = (stream, state) => {
                var ch = stream.next()
                if (ch == '@') {
                    stream.eatWhile(/\w/)
                    return ret('css-at', stream.current());
                } else {
                    state.tokenize = tokenCComment
                    return tokenCComment(stream, state)
                }
            }

            const tokenCComment = (stream, state) => {
                var maybeEnd = false, ch
                while ((ch = stream.next()) != null) {
                    if (maybeEnd && ch == '/') {
                        state.tokenize = tokenBase
                        break
                    }
                    maybeEnd = (ch == '*')
                }
                return ret('css-comment', 'comment')
            }

            const tokenSGMLComment = (stream, state) => {
                var dashes = 0, ch
                while ((ch = stream.next()) != null) {
                    if (dashes >= 2 && ch == '>') {
                        state.tokenize = tokenBase
                        break
                    }
                    dashes = (ch == '-') ? dashes + 1 : 0
                }
                return ret('css-comment', 'comment')
            }

            const tokenString = quote => (stream, state) => {
                var escaped = false, ch
                while ((ch = stream.next()) != null) {
                    if (ch == quote && !escaped)
                        break
                    escaped = !escaped && ch == '\\'
                }
                if (!escaped) state.tokenize = tokenBase
                return ret('css-string', 'string')
            }

            return {
                startState: base => ({ tokenize: tokenBase, aseIndent: base || 0, stack: [] }),
                token: (stream, state) => {
                    if (stream.eatSpace()) return null
                    var style = state.tokenize(stream, state)

                    var context = state.stack[state.stack.length - 1]
                    if (type == 'hash' && context == 'rule') style = 'css-colorcode'
                    else if (style == 'css-identifier') {
                        if (context == 'rule') style = 'css-value'
                        else if (!context || context == '@media{') style = 'css-selector'
                    }

                    if (context == 'rule' && /^[\{\};]$/.test(type)) state.stack.pop()
                    if (type == '{') {
                        if (context == '@media') state.stack[state.stack.length - 1] = '@media{'
                        else state.stack.push('{')
                    }
                    else if (type == '}') state.stack.pop()
                    else if (type == '@media') state.stack.push('@media')
                    else if (context != 'rule' && context != '@media' && type != 'comment') state.stack.push('rule')
                    return style;
                },
                indent: (state, textAfter) => {
                    var n = state.stack.length;
                    if (/^\}/.test(textAfter))
                        n -= state.stack[state.stack.length - 1] == 'rule' ? 2 : 1;
                    return state.baseIndent + n * indentUnit;
                },
                electricChars: '}'
            }
        })
        defineMIME('text/css', 'css')
        var badInnerHTML = (function () {
            var pre = document.createElement('pre')
            pre.innerHTML = ' '
            return !pre.innerHTML
        })()
        //#endregion

        //#region Local Vars
        var gecko = /gecko\/\d{7}/i.test(navigator.userAgent)

        // Delayed object wrap timeouts, making sure only one is active. blinker holds an interval.
        var poll = new Delayed()
        var highlight = new Delayed()
        var blinker

        // mode holds a mode API object. 
        // lines an array of Line objects (see Line constructor), 
        // work an array of lines that should be parsed, 
        // and history the undo history (instance of History constructor).
        var mode
        var lines = [new Line('')]
        var work = [0]
        var history = new History()
        var focused
        loadMode()

        // The selection. 
        // These are always maintained to point at valid positions. 
        // Inverted is used to remember that the user is selecting bottom-to-top.
        var sel = {
            from: {
                line: 0,
                ch: 0
            },
            to: {
                line: 0,
                ch: 0
            },
            inverted: false
        }

        // Selection-related flags. 
        // shiftSelecting obviously tracks whether the user is holding shift. 
        // reducedSelection is a hack to get around the fact that we can't create inverted selections. See below.
        var shiftSelecting
        var reducedSelection

        // Variables used by startOperation/endOperation to track what happened during the operation.
        var updateInput
        var changes
        var textChanged
        var selectionChanged
        var leaveInputAlone

        // Current visible range (may be bigger than the view window).
        var showingFrom = 0
        var showingTo = 0
        var lastHeight = 0
        var curKeyId = null

        // editing will hold an object describing the things we put in the
        // textarea, to help figure out whether something changed.
        // bracketHighlighted is used to remember that a backet has been marked.
        var editing
        var bracketHighlighted

        // Ensures slowPoll doesn't cancel fastPoll
        var pollingFast = false
        var tabSize = 8
        var mac = /Mac/.test(navigator.platform)
        var movementKeys = {}
        for (var i = 35; i <= 40; ++i) {
            movementKeys[i] = movementKeys['c' + i] = true
        }
        var lineSep = "\n";
        //#endregion

        //#region Operation
        var nestedOperation = 0
        const startOperation = () => {
            updateInput = null
            changes = []
            textChanged = selectionChanged = false
        }

        const endOperation = () => {
            var reScroll = false
            if (selectionChanged) {
                reScroll = !scrollCursorIntoView()
            }
            if (changes.length) {
                updateDisplay(changes)
            } else if (selectionChanged) {
                updateCursor()
            }
            if (reScroll) {
                scrollCursorIntoView()
            }
            if (selectionChanged) {
                restartBlink()
            }

            // updateInput can be set to a boolean value to force/prevent an
            // update.
            if (!leaveInputAlone && (updateInput === true || (updateInput !== false && selectionChanged))) {
                prepareInput()
            }
            if (selectionChanged && options.onCursorActivity) {
                options.onCursorActivity(instance)
            }
            if (textChanged && options.onChange) {
                options.onChange(instance)
            }
            if (selectionChanged && options.matchBrackets) {
                setTimeout(operation(function () {
                    if (bracketHighlighted) {
                        bracketHighlighted()
                        bracketHighlighted = null
                    }
                    matchBrackets(false)
                }), 20)
            }
        }

        function operation(f) {
            return function () {
                if (!nestedOperation++) {
                    startOperation()
                }
                try {
                    var result = f.apply(window, arguments)
                } finally {
                    if (!--nestedOperation) {
                        endOperation()
                    }
                }
                return result
            }
        }
        //#endregion

        //#region Pooling
        const slowPoll = () => {
            if (pollingFast) {
                return
            }
            poll.set(2000, function () {
                startOperation()
                readInput()
                if (focused) {
                    slowPoll()
                }
                endOperation()
            })
        }
        const fastPoll = keyId => {
            var missed = false
            pollingFast = true
            function p() {
                startOperation()
                var changed = readInput()
                if (changed == 'moved' && keyId) {
                    movementKeys[keyId] = true
                }
                if (!changed && !missed) {
                    missed = true
                    poll.set(80, p)
                } else {
                    pollingFast = false
                    slowPoll()
                }
                endOperation()
            }
            poll.set(20, p)
        }
        //#endregion

        //#region  Event Handlers
        const onMouseDown = e => {
            // First, see if this is a click in the gutter
            for (var n = e.target(); n != wrapper; n = n.parentNode) {
                if (n.parentNode == gutterText) {
                    if (options.onGutterClick) {
                        options.onGutterClick(instance, indexOf(gutterText.childNodes, n) + showingFrom)
                    }
                    return e.stop()
                }
            }
            if (gecko && e.button() == 3) {
                onContextMenu(e)
            }
            if (e.button() != 1) {
                return
            }
            // For button 1, if it was clicked inside the editor
            // (posFromMouse returning non-null), we have to adjust the
            // selection.
            var start = posFromMouse(e)
            var last = start
            var going

            if (!start) {
                if (e.target() == wrapper) {
                    e.stop()
                }
                return
            }
            setCursor(start.line, start.ch, false)

            if (!focused) {
                onFocus()
            }
            e.stop()
            // And then we have to see if it's a drag event, in which case
            // the dragged-over text must be selected.
            function end() {
                input.focus()
                updateInput = true
                move()
                up()
            }

            function extend(e) {
                var cur = posFromMouse(e, true)
                if (cur && !posEq(cur, last)) {
                    if (!focused) {
                        onFocus()
                    }
                    last = cur
                    setSelection(start, cur)
                    updateInput = false
                    var visible = visibleLines()
                    if (cur.line >= visible.to || cur.line < visible.from) {
                        going = setTimeout(operation(function () {
                            extend(e)
                        }), 150)
                    }
                }
            }

            var move = connect(document, 'mousemove', operation(function (e) {
                clearTimeout(going)
                e.stop()
                extend(e)
            }), true)
            var up = connect(document, 'mouseup', operation(function (e) {
                clearTimeout(going)
                var cur = posFromMouse(e)
                if (cur) {
                    setSelection(start, cur)
                }
                e.stop()
                end()
            }), true)
        }
        const onContextMenu = e => {
            var pos = posFromMouse(e)
            if (!pos || window.opera) {
                return // Opera is difficult.
            }
            if (posEq(sel.from, sel.to) || posLess(pos, sel.from) || !posLess(pos, sel.to)) {
                setCursor(pos.line, pos.ch)
            }
            var oldCSS = input.style.cssText
            input.style.cssText = 'position: fixed; width: 30px; height: 30px; top: ' + (e.pageY() - 1) +
                'px; left: ' + (e.pageX() - 1) + 'px; z-index: 1000; background: white; ' +
                'border-width: 0; outline: none; overflow: hidden;'
            var val = input.value = getSelection()
            input.focus()
            setSelRange(input, 0, val.length)
            if (gecko) {
                e.stop()
            }
            leaveInputAlone = true
            setTimeout(function () {
                if (input.value != val) {
                    operation(replaceSelection)(input.value, 'end')
                }
                input.style.cssText = oldCSS
                leaveInputAlone = false
                prepareInput()
                slowPoll()
            }, 50)
        }
        const onDblClick = e => {
            var pos = posFromMouse(e)
            if (!pos) {
                return
            }
            selectWordAt(pos)
            e.stop()
        }
        const onDrop = e => {
            var pos = posFromMouse(e, true)
            var files = e.e.dataTransfer.files
            if (!pos || options.readOnly) {
                return
            }
            if (files && files.length && window.FileReader && window.File) {
                var n = files.length
                var text = Array(n)
                var read = 0
                for (var i = 0; i < n; ++i) {
                    loadFile(files[i], i)
                }

                function loadFile(file, i) {
                    var reader = new FileReader
                    reader.onload = function () {
                        text[i] = reader.result
                        if (++read == n) {
                            replaceRange(text.join(''), clipPos(pos), clipPos(pos))
                        }
                    }
                    reader.readAsText(file)
                }
            }
            else {
                try {
                    var text = e.e.dataTransfer.getData('Text')
                    if (text) {
                        replaceRange(text, pos, pos)
                    }
                } catch (e) { }
            }
        }
        const onFocus = () => {
            if (!focused && options.onFocus) {
                options.onFocus(instance)
            }
            focused = true
            slowPoll()
            if (wrapper.className.search(/\bXliffEditor-focused\b/) == -1) {
                wrapper.className += ' XliffEditor-focused'
            }
            restartBlink()
        }
        const onBlur = () => {
            if (focused && options.onBlur) {
                options.onBlur(instance)
            }
            clearInterval(blinker)
            shiftSelecting = null
            focused = false
            wrapper.className = wrapper.className.replace(' XliffEditor-focused', '')
        }
        const onKeyUp = e => {
            if (reducedSelection) {
                reducedSelection = null
                updateInput = true
            }
            if (e.e.keyCode == 16) {
                shiftSelecting = null
            }
        }
        const onKeyDown = e => {
            if (!focused) {
                onFocus()
            }

            var code = e.e.keyCode
            // Tries to detect ctrl on non-mac, cmd on mac.
            var mod = (mac ? e.e.metaKey : e.e.ctrlKey) && !e.e.altKey
            var anyMod = e.e.ctrlKey || e.e.altKey || e.e.metaKey

            if (code == 16 || e.e.shiftKey) {
                shiftSelecting = shiftSelecting || (sel.inverted ? sel.to : sel.from)
            } else {
                shiftSelecting = null
            }
            // First give onKeyEvent option a chance to handle this.
            if (options.onKeyEvent && options.onKeyEvent(instance, addStop(e.e))) {
                return
            }

            if (code == 33 || code == 34) { // page up/down
                scrollPage(code == 34)
                return e.stop()
            }
            if (mod && (code == 36 || code == 35)) { // ctrl-home/end
                scrollEnd(code == 36)
                return e.stop()
            }
            if (mod && code == 65) { // ctrl-a
                selectAll()
                return e.stop()
            }
            if (!options.readOnly) {
                if (!anyMod && code == 13) { // enter
                    return
                }
                if (!anyMod && code == 9 && handleTab(e.e.shiftKey)) { // tab
                    return e.stop()
                }
                if (mod && code == 90) { // ctrl-z
                    undo()
                    return e.stop()
                }
                if (mod && ((e.e.shiftKey && code == 90) || code == 89)) { // ctrl-shift-z, ctrl-y
                    redo()
                    return e.stop()
                }
            }

            // Key id to use in the movementKeys map. We also pass it to
            // fastPoll in order to 'self learn'. We need this because
            // reducedSelection, the hack where we collapse the selection to
            // its start when it is inverted and a movement key is pressed
            // (and later restore it again), shouldn't be used for
            // non-movement keys.
            curKeyId = (mod ? 'c' : '') + code
            if (sel.inverted && movementKeys.hasOwnProperty(curKeyId)) {
                var range = selRange(input)
                if (range) {
                    reducedSelection = { anchor: range.start }
                    setSelRange(input, range.start, range.start)
                }
            }
            fastPoll(curKeyId)
        }
        const onKeyPress = e => {
            if (options.onKeyEvent && options.onKeyEvent(instance, addStop(e.e))) {
                return
            }
            var code = e.e.keyCode
            // Re-stop tab and enter. Necessary on some browsers.
            if (code == 13) {
                handleEnter()
                e.stop()
            } else if (code == 9 && options.tabMode != 'default') {
                e.stop()
            } else {
                fastPoll(curKeyId)
            }
        }
        const posFromMouse = (e, liberal) => {
            var off = eltOffset(lineSpace)
            var x = e.pageX() - off.left
            var y = e.pageY() - off.top
            if (!liberal && e.target() != lineSpace.parentNode && !(e.target() == wrapper && y > (lines.length * lineHeight()))) {
                for (var n = e.target(); n != lineDiv && n != cursor; n = n.parentNode) {
                    if (!n || n == wrapper) {
                        return null
                    }
                }
            }
            var line = showingFrom + Math.floor(y / lineHeight())
            return clipPos({ line: line, ch: charFromX(clipLine(line), x) })
        }
        const eltOffset = node => {
            var x = 0
            var y = 0
            var n2 = node
            for (var n = node; n; n = n.offsetParent) {
                x += n.offsetLeft
                y += n.offsetTop
            }
            for (var n = node; n != document.body; n = n.parentNode) {
                x -= n.scrollLeft
                y -= n.scrollTop
            }
            return { left: x, top: y }
        }
        const eltText = node => node.textContent || node.innerText || node.nodeValue || ''
        const posEq = (a, b) => a.line == b.line && a.ch == b.ch
        const posLess = (a, b) => a.line < b.line || (a.line == b.line && a.ch < b.ch)
        const copyPos = x => ({ line: x.line, ch: x.ch })
        //const htmlEscape = str => str.replace(/[<&]/g, function (str) { return str == '&' ? '&amp;' : '&lt;'; })
        const lineHeight = () => {
            var nlines = lineDiv.childNodes.length
            if (nlines) {
                return lineDiv.offsetHeight / nlines
            } else {
                return measure.firstChild.offsetHeight || 1
            }
        }
        const charFromX = (line, x) => {
            var text = lines[line].text
            var cw = charWidth()
            if (x <= 0) {
                return 0
            }
            if (text.indexOf("\t") == -1) {
                return Math.min(text.length, Math.round(x / cw))
            }
            var mspan = measure.firstChild
            var mtext = mspan.firstChild
            var old = mtext.nodeValue
            try {
                mtext.nodeValue = text
                var from = 0
                var fromX = 0
                var to = text.length
                var toX = mspan.offsetWidth
                if (x > toX) {
                    return to
                }
                for (; ;) {
                    if (to - from <= 1) {
                        return (toX - x > x - fromX) ? from : to
                    }
                    var middle = Math.ceil((from + to) / 2)
                    mtext.nodeValue = text.slice(0, middle)
                    var curX = mspan.offsetWidth
                    if (curX > x) {
                        to = middle
                        toX = curX
                    } else {
                        from = middle
                        fromX = curX
                    }
                }
            } finally {
                mtext.nodeValue = old
            }
        }
        const localCoords = (pos, inLineWrap) => {
            var lh = lineHeight()
            var line = pos.line - (inLineWrap ? showingFrom : 0)
            return { x: charX(pos.line, pos.ch), y: line * lh, yBot: (line + 1) * lh }
        }
        const pageCoords = pos => {
            var local = localCoords(pos, true)
            var off = eltOffset(lineSpace)
            return { x: off.left + local.x, y: off.top + local.y, yBot: off.top + local.yBot }
        }
        const charWidth = () => (measure.firstChild.offsetWidth || 320) / 40
        const paddingTop = () => lineSpace.offsetTop
        const restartBlink = () => {
            clearInterval(blinker)
            var on = true
            cursor.style.visibility = ''
            blinker = setInterval(function () {
                cursor.style.visibility = (on = !on) ? '' : 'hidden'
            }, 650)
        }
        const paddingLeft = () => lineSpace.offsetLeft
        const findStartLine = n => {
            var minindent
            var minline
            for (var search = n, lim = n - 40; search > lim; --search) {
                if (search == 0) {
                    return 0
                }
                var line = lines[search - 1]
                if (line.stateAfter) {
                    return search
                }
                var indented = line.indentation()
                if (minline == null || minindent > indented) {
                    minline = search
                    minindent = indented
                }
            }
            return minline
        }
        const getStateBefore = n => {
            var start = findStartLine(n)
            var state = start && lines[start - 1].stateAfter
            if (!state) {
                state = startState(mode)
            } else {
                state = copyState(mode, state)
            }
            for (var i = start; i < n; ++i) {
                var line = lines[i]
                line.highlight(mode, state)
                line.stateAfter = copyState(mode, state)
            }
            if (!lines[n].stateAfter) {
                work.push(n)
            }
            return state
        }
        const updateLines = (from, to, newText, selFrom, selTo) => {
            if (history) {
                var old = []
                for (var i = from.line, e = to.line + 1; i < e; ++i) {
                    old.push(lines[i].text)
                }
                history.addChange(from.line, newText.length, old)
                while (history.done.length > options.undoDepth) {
                    history.done.shift()
                }
            }
            updateLinesNoUndo(from, to, newText, selFrom, selTo)
        }
        const getValue = () => lines.map(line => line.text).join('\n')
        const setValue = val => {
            history = null
            var top = { line: 0, ch: 0 }
            updateLines(top, { line: lines.length - 1, ch: lines[lines.length - 1].text.length }, splitLines(val), top, top)
            history = new History()
        }
        const getSelection = () => getRange(sel.from, sel.to)
        const getRange = (from, to) => {
            var l1 = from.line
            var l2 = to.line
            if (l1 == l2) {
                return lines[l1].text.slice(from.ch, to.ch)
            }
            var code = [lines[l1].text.slice(from.ch)]
            for (var i = l1 + 1; i < l2; ++i) {
                code.push(lines[i].text)
            }
            code.push(lines[l2].text.slice(0, to.ch))
            return code.join('\n')
        }
        const replaceRange = (code, from, to) => {
            from = clipPos(from)
            if (!to) {
                to = from
            } else {
                to = clipPos(to)
            }
            code = splitLines(code)

            function adjustPos(pos) {
                if (posLess(pos, from)) {
                    return pos
                }
                if (!posLess(to, pos)) {
                    return end
                }
                var line = pos.line + code.length - (to.line - from.line) - 1
                var ch = pos.ch
                if (pos.line == to.line) {
                    ch += code[code.length - 1].length - (to.ch - (to.line == from.line ? from.ch : 0))
                }
                return { line: line, ch: ch }
            }
            var end
            replaceRange1(code, from, to, function (end1) {
                end = end1
                return { from: adjustPos(sel.from), to: adjustPos(sel.to) }
            })
            return end
        }
        const replaceRange1 = (code, from, to, computeSel) => {
            var endch = code.length == 1 ? code[0].length + from.ch : code[code.length - 1].length
            var newSel = computeSel({ line: from.line + code.length - 1, ch: endch })
            updateLines(from, to, code, newSel.from, newSel.to)
        }
        const replaceSelection = (code, collapse) => {
            replaceRange1(splitLines(code), sel.from, sel.to, end => {
                switch (collapse) {
                    case 'end': return { from: end, to: end }
                    case 'start': return { from: sel.from, to: sel.from }
                    default: return { from: sel.from, to: end }
                }
            })
        }
        const undo = () => unredoHelper(history.done, history.undone)
        const redo = () => unredoHelper(history.undone, history.done)
        const clipPos = pos => {
            if (pos.line < 0) {
                return { line: 0, ch: 0 }
            }
            if (pos.line >= lines.length) {
                return { line: lines.length - 1, ch: lines[lines.length - 1].text.length }
            }
            var ch = pos.ch
            var linelen = lines[pos.line].text.length
            if (ch == null || ch > linelen) {
                return { line: pos.line, ch: linelen }
            } else if (ch < 0) {
                return { line: pos.line, ch: 0 }
            } else {
                return pos
            }
        }
        const addGutterMarker = (line, text, className) => {
            if (typeof line == 'number') {
                line = lines[clipLine(line)]
            }
            line.gutterMarker = { text: text, style: className }
            updateGutter()
            return line
        }
        const removeGutterMarker = line => {
            if (typeof line == 'number') {
                line = lines[clipLine(line)]
            }
            line.gutterMarker = null
            updateGutter()
        }
        const setLineClass = (line, className) => {
            if (typeof line == 'number') {
                var no = line
                line = lines[clipLine(line)]
            } else {
                var no = indexOf(lines, line)
                if (no == -1) {
                    return null
                }
            }
            line.className = className
            changes.push({ from: no, to: no + 1 })
            return line
        }
        const lineInfo = (line) => {
            if (typeof line == 'number') {
                var n = line
                line = lines[line]
                if (!line) {
                    return null
                }
            }
            else {
                var n = indexOf(lines, line)
                if (n == -1) {
                    return null
                }
            }
            var marker = line.gutterMarker
            return { line: n, text: line.text, markerText: marker && marker.text, markerClass: marker && marker.style }
        }
        const highlightWorker = () => {
            var end = +new Date + options.workTime
            while (work.length) {
                if (!lines[showingFrom].stateAfter) {
                    var task = showingFrom
                } else {
                    var task = work.pop()
                }
                if (task >= lines.length) {
                    continue
                }
                var start = findStartLine(task)
                var state = start && lines[start - 1].stateAfter
                if (state) {
                    state = copyState(mode, state)
                } else {
                    state = startState(mode)
                }

                for (var i = start, l = lines.length; i < l; ++i) {
                    var line = lines[i]
                    var hadState = line.stateAfter
                    if (+new Date > end) {
                        work.push(i)
                        startWorker(options.workDelay)
                        changes.push({ from: task, to: i })
                        return
                    }
                    var changed = line.highlight(mode, state)
                    line.stateAfter = copyState(mode, state)
                    if (hadState && !changed && line.text) {
                        break
                    }
                }
                changes.push({ from: task, to: i })
            }
        }
        const startWorker = time => {
            if (!work.length) {
                return
            }
            highlight.set(time, operation(highlightWorker))
        }
        const clipLine = n => Math.max(0, Math.min(n, lines.length - 1))
        const setCursor = (line, ch) => {
            var pos = clipPos({ line: line, ch: ch || 0 })
            setSelection(pos, pos)
        }
        const selRange = te => {
            try {
                return { start: te.selectionStart, end: te.selectionEnd }
            } catch (e) {
                return null
            }
        }
        var setSelRange = function (te, start, end) {
            try {
                te.setSelectionRange(start, end)
            } catch (e) { } // Fails on Firefox when textarea isn't part of the document
        }
        const setSelection = (from, to, oldFrom, oldTo) => {
            if (posEq(sel.from, from) && posEq(sel.to, to)) {
                return
            }
            var sh = shiftSelecting && clipPos(shiftSelecting)
            if (posLess(to, from)) {
                var tmp = to
                to = from
                from = tmp
            }
            if (sh) {
                if (posLess(sh, from)) {
                    from = sh
                } else if (posLess(to, sh)) {
                    to = sh
                }
            }

            var startEq = posEq(sel.to, to)
            var endEq = posEq(sel.from, from)
            if (posEq(from, to)) {
                sel.inverted = false
            } else if (startEq && !endEq) {
                sel.inverted = true
            } else if (endEq && !startEq) {
                sel.inverted = false
            }

            // Some ugly logic used to only mark the lines that actually did
            // see a change in selection as changed, rather than the whole
            // selected range.
            if (oldFrom == null) {
                oldFrom = sel.from.line
                oldTo = sel.to.line
            }
            if (posEq(from, to)) {
                if (!posEq(sel.from, sel.to)) {
                    changes.push({ from: oldFrom, to: oldTo + 1 })
                }
            } else if (posEq(sel.from, sel.to)) {
                changes.push({ from: from.line, to: to.line + 1 })
            } else {
                if (!posEq(from, sel.from)) {
                    if (from.line < oldFrom) {
                        changes.push({ from: from.line, to: Math.min(to.line, oldFrom) + 1 })
                    } else {
                        changes.push({ from: oldFrom, to: Math.min(oldTo, from.line) + 1 })
                    }
                }
                if (!posEq(to, sel.to)) {
                    if (to.line < oldTo) {
                        changes.push({ from: Math.max(oldFrom, from.line), to: oldTo + 1 })
                    } else {
                        changes.push({ from: Math.max(from.line, oldTo), to: to.line + 1 })
                    }
                }
            }
            sel.from = from
            sel.to = to
            selectionChanged = true
        }
        const updateCursor = () => {
            var head = sel.inverted ? sel.from : sel.to
            var x = charX(head.line, head.ch) + 'px'
            var y = (head.line - showingFrom) * lineHeight() + 'px'
            inputDiv.style.top = y
            inputDiv.style.left = x
            if (posEq(sel.from, sel.to)) {
                cursor.style.top = y
                cursor.style.left = x
                cursor.style.display = ''
            }
            else cursor.style.display = 'none'
        }
        const updateGutter = () => {
            if (!options.gutter && !options.lineNumbers) {
                return
            }
            var hText = mover.offsetHeight
            var hEditor = wrapper.clientHeight
            gutter.style.height = (hText - hEditor < 2 ? hEditor : hText) + 'px'
            var html = []
            for (var i = showingFrom; i < showingTo; ++i) {
                var marker = lines[i].gutterMarker
                var text = options.lineNumbers ? i + options.firstLineNumber : null
                if (marker && marker.text) {
                    text = marker.text.replace("%N%", text != null ? text : '')
                } else if (text == null) {
                    text = "\u00a0"
                }
                html.push((marker && marker.style ? '<pre class="' + marker.style + '">' : '<pre>'), text, '</pre>')
            }
            gutter.style.display = 'none'
            gutterText.innerHTML = html.join('')
            var minwidth = String(lines.length).length
            var firstNode = gutterText.firstChild
            var val = eltText(firstNode)
            var pad = ''
            while (val.length + pad.length < minwidth) {
                pad += "\u00a0"
            }
            if (pad) {
                firstNode.insertBefore(document.createTextNode(pad), firstNode.firstChild)
            }
            gutter.style.display = ''
            lineSpace.style.marginLeft = gutter.offsetWidth + 'px'
        }
        const patchDisplay = updates => {
            // Slightly different algorithm for IE (badInnerHTML), since
            // there .innerHTML on PRE nodes is dumb, and discards
            // whitespace.
            var sfrom = sel.from.line
            var sto = sel.to.line
            var off = 0
            var scratch = badInnerHTML && document.createElement('div')
            for (var i = 0, e = updates.length; i < e; ++i) {
                var rec = updates[i]
                var extra = (rec.to - rec.from) - rec.domSize
                var nodeAfter = lineDiv.childNodes[rec.domStart + rec.domSize + off] || null
                if (badInnerHTML) {
                    for (var j = Math.max(-extra, rec.domSize); j > 0; --j) {
                        lineDiv.removeChild(nodeAfter ? nodeAfter.previousSibling : lineDiv.lastChild)
                    }
                } else if (extra) {
                    for (var j = Math.max(0, extra); j > 0; --j) {
                        lineDiv.insertBefore(document.createElement('pre'), nodeAfter)
                    }
                    for (var j = Math.max(0, -extra); j > 0; --j) {
                        lineDiv.removeChild(nodeAfter ? nodeAfter.previousSibling : lineDiv.lastChild)
                    }
                }
                var node = lineDiv.childNodes[rec.domStart + off]
                var inSel = sfrom < rec.from && sto >= rec.from
                for (var j = rec.from; j < rec.to; ++j) {
                    var ch1 = null
                    var ch2 = null
                    if (inSel) {
                        ch1 = 0
                        if (sto == j) {
                            inSel = false
                            ch2 = sel.to.ch
                        }
                    } else if (sfrom == j) {
                        if (sto == j) {
                            ch1 = sel.from.ch
                            ch2 = sel.to.ch
                        } else {
                            inSel = true
                            ch1 = sel.from.ch
                        }
                    }
                    if (badInnerHTML) {
                        scratch.innerHTML = lines[j].getHTML(ch1, ch2, true)
                        lineDiv.insertBefore(scratch.firstChild, nodeAfter)
                    } else {
                        node.innerHTML = lines[j].getHTML(ch1, ch2, false)
                        node.className = lines[j].className || ''
                        node = node.nextSibling
                    }
                }
                off += extra
            }
        }
        const refreshDisplay = (from, to) => {
            var html = []
            var start = { line: from, ch: 0 }
            var inSel = posLess(sel.from, start) && !posLess(sel.to, start)
            for (var i = from; i < to; ++i) {
                var ch1 = null
                var ch2 = null
                if (inSel) {
                    ch1 = 0
                    if (sel.to.line == i) {
                        inSel = false
                        ch2 = sel.to.ch
                    }
                } else if (sel.from.line == i) {
                    if (sel.to.line == i) {
                        ch1 = sel.from.ch
                        ch2 = sel.to.ch
                    } else {
                        inSel = true
                        ch1 = sel.from.ch
                    }
                }
                html.push(lines[i].getHTML(ch1, ch2, true))
            }
            lineDiv.innerHTML = html.join('')
        }
        const visibleLines = () => {
            var lh = lineHeight()
            var top = wrapper.scrollTop - paddingTop()
            return {
                from: Math.min(lines.length, Math.max(0, Math.floor(top / lh))),
                to: Math.min(lines.length, Math.ceil((top + wrapper.clientHeight) / lh))
            }
        }
        const updateDisplay = changes => {
            if (!wrapper.clientWidth) {
                showingFrom = showingTo = 0
                return
            }
            // First create a range of theoretically intact lines, and punch
            // holes in that using the change info.
            var intact = changes === true ? [] : [{ from: showingFrom, to: showingTo, domStart: 0 }]
            for (var i = 0, l = changes.length || 0; i < l; ++i) {
                var change = changes[i]
                var intact2 = []
                var diff = change.diff || 0
                for (var j = 0, l2 = intact.length; j < l2; ++j) {
                    var range = intact[j]
                    if (change.to <= range.from) {
                        intact2.push({ from: range.from + diff, to: range.to + diff, domStart: range.domStart })
                    } else if (range.to <= change.from) {
                        intact2.push(range)
                    } else {
                        if (change.from > range.from) {
                            intact2.push({ from: range.from, to: change.from, domStart: range.domStart })
                        }
                        if (change.to < range.to) {
                            intact2.push({
                                from: change.to + diff, to: range.to + diff,
                                domStart: range.domStart + (change.to - range.from)
                            })
                        }
                    }
                }
                intact = intact2
            }

            // Then, determine which lines we'd want to see, and which
            // updates have to be made to get there.
            var visible = visibleLines()
            var from = Math.min(showingFrom, Math.max(visible.from - 3, 0))
            var to = Math.min(lines.length, Math.max(showingTo, visible.to + 3))
            var updates = []
            var domPos = 0
            var domEnd = showingTo - showingFrom
            var pos = from
            var changedLines = 0

            for (var i = 0, l = intact.length; i < l; ++i) {
                var range = intact[i]
                if (range.to <= from) {
                    continue
                }
                if (range.from >= to) {
                    break
                }
                if (range.domStart > domPos || range.from > pos) {
                    updates.push({ from: pos, to: range.from, domSize: range.domStart - domPos, domStart: domPos })
                    changedLines += range.from - pos
                }
                pos = range.to
                domPos = range.domStart + (range.to - range.from)
            }
            if (domPos != domEnd || pos != to) {
                changedLines += Math.abs(to - pos)
                updates.push({ from: pos, to: to, domSize: domEnd - domPos, domStart: domPos })
            }

            if (!updates.length) {
                return
            }
            lineDiv.style.display = 'none'
            // If more than 30% of the screen needs update, just do a full
            // redraw (which is quicker than patching)
            if (changedLines > (visible.to - visible.from) * .3) {
                refreshDisplay(from = Math.max(visible.from - 10, 0), to = Math.min(visible.to + 7, lines.length))
            } else {
                // Otherwise, only update the stuff that needs updating.
                patchDisplay(updates)
            }
            lineDiv.style.display = ''

            // Position the mover div to align with the lines it's supposed
            // to be showing (which will cover the visible display)
            var different = from != showingFrom || to != showingTo || lastHeight != wrapper.clientHeight
            showingFrom = from
            showingTo = to
            mover.style.top = (from * lineHeight()) + 'px'
            if (different) {
                lastHeight = wrapper.clientHeight
                code.style.height = (lines.length * lineHeight() + 2 * paddingTop()) + 'px'
                updateGutter()
            }

            // Since this is all rather error prone, it is honoured with the
            // only assertion in the whole file.
            if (lineDiv.childNodes.length != showingTo - showingFrom) {
                throw new Error('BAD PATCH! ' + JSON.stringify(updates) + ' size=' + (showingTo - showingFrom) + ' nodes=' + lineDiv.childNodes.length)
            }
            updateCursor()
        }
        const scrollIntoView = (x1, y1, x2, y2) => {
            var pl = paddingLeft()
            var pt = paddingTop()
            y1 += pt
            y2 += pt
            x1 += pl
            x2 += pl
            var screen = wrapper.clientHeight
            var screentop = wrapper.scrollTop
            var scrolled = false
            var result = true
            if (y1 < screentop) {
                wrapper.scrollTop = Math.max(0, y1 - 10)
                scrolled = true
            } else if (y2 > screentop + screen) {
                wrapper.scrollTop = y2 + 10 - screen
                scrolled = true
            }

            var screenw = wrapper.clientWidth
            var screenleft = wrapper.scrollLeft
            if (x1 < screenleft) {
                wrapper.scrollLeft = Math.max(0, x1 - 10)
                scrolled = true
            } else if (x2 > screenw + screenleft) {
                wrapper.scrollLeft = x2 + 10 - screenw
                scrolled = true
                if (x2 > code.clientWidth) {
                    result = false
                }
            }
            if (scrolled && options.onScroll) {
                options.onScroll(instance)
            }
            return result
        }
        const scrollCursorIntoView = () => {
            var cursor = localCoords(sel.inverted ? sel.from : sel.to)
            return scrollIntoView(cursor.x, cursor.y, cursor.x, cursor.yBot)
        }
        const prepareInput = () => {
            var text = []
            var from = Math.max(0, sel.from.line - 1)
            var to = Math.min(lines.length, sel.to.line + 2)
            for (var i = from; i < to; ++i) {
                text.push(lines[i].text)
            }
            text = input.value = text.join(lineSep)
            var startch = sel.from.ch
            var endch = sel.to.ch
            for (var i = from; i < sel.from.line; ++i) {
                startch += lineSep.length + lines[i].text.length
            }
            for (var i = from; i < sel.to.line; ++i) {
                endch += lineSep.length + lines[i].text.length
            }
            editing = { text: text, from: from, to: to, start: startch, end: endch }
            setSelRange(input, startch, reducedSelection ? startch : endch)
        }
        const readInput = () => {
            var changed = false
            var text = input.value
            var sr = selRange(input)
            if (!sr) {
                return false
            }
            var changed = editing.text != text
            var rs = reducedSelection
            var moved = changed || sr.start != editing.start || sr.end != (rs ? editing.start : editing.end)
            if (reducedSelection && !moved && sel.from.line == 0 && sel.from.ch == 0) {
                reducedSelection = null
            } else if (!moved) {
                return false
            }
            if (changed) {
                shiftSelecting = reducedSelection = null
                if (options.readOnly) {
                    updateInput = true
                    return 'changed'
                }
            }

            // Compute selection start and end based on start/end offsets in textarea
            function computeOffset(n, startLine) {
                var pos = 0
                for (; ;) {
                    var found = text.indexOf("\n", pos)
                    if (found == -1 || (text.charAt(found - 1) == "\r" ? found - 1 : found) >= n) {
                        return { line: startLine, ch: n - pos }
                    }
                    ++startLine
                    pos = found + 1
                }
            }
            var from = computeOffset(sr.start, editing.from)
            var to = computeOffset(sr.end, editing.from);
            // Here we have to take the reducedSelection hack into account,
            // so that you can, for example, press shift-up at the start of
            // your selection and have the right thing happen.
            if (rs) {
                from = sr.start == rs.anchor ? to : from
                to = shiftSelecting ? sel.to : sr.start == rs.anchor ? from : to
                if (!posLess(from, to)) {
                    reducedSelection = null
                    sel.inverted = false
                    var tmp = from
                    from = to
                    to = tmp
                }
            }

            // In some cases (cursor on same line as before), we don't have
            // to update the textarea content at all.
            if (from.line == to.line && from.line == sel.from.line && from.line == sel.to.line && !shiftSelecting) {
                updateInput = false
            }

            // Magic mess to extract precise edited range from the changed
            // string.
            if (changed) {
                var start = 0
                var end = text.length
                var len = Math.min(end, editing.text.length)
                var c
                var line = editing.from
                var nl = -1
                while (start < len && (c = text.charAt(start)) == editing.text.charAt(start)) {
                    ++start
                    if (c == "\n") {
                        line++
                        nl = start
                    }
                }
                var ch = nl > -1 ? start - nl : start
                var endline = editing.to - 1
                var edend = editing.text.length

                for (; ;) {
                    c = editing.text.charAt(edend)
                    if (c == "\n") {
                        endline--
                    }
                    if (text.charAt(end) != c) {
                        ++end
                        ++edend
                        break
                    }
                    if (edend <= start || end <= start) {
                        break
                    }
                    --end
                    --edend
                }
                var nl = editing.text.lastIndexOf("\n", edend - 1)
                var endch = nl == -1 ? edend : edend - nl - 1
                updateLines({ line: line, ch: ch }, { line: endline, ch: endch }, splitLines(text.slice(start, end)), from, to)
                if (line != endline || from.line != line) {
                    updateInput = true
                }
            } else {
                setSelection(from, to)
            }

            editing.text = text
            editing.start = sr.start
            editing.end = sr.end
            return changed ? 'changed' : moved ? 'moved' : false
        }
        const updateLinesNoUndo = (from, to, newText, selFrom, selTo) => {
            var nlines = to.line - from.line
            var firstLine = lines[from.line]
            var lastLine = lines[to.line]
            // First adjust the line structure, taking some care to leave highlighting intact.
            if (firstLine == lastLine) {
                if (newText.length == 1) {
                    firstLine.replace(from.ch, to.ch, newText[0])
                } else {
                    lastLine = firstLine.split(to.ch, newText[newText.length - 1])
                    var spliceargs = [from.line + 1, nlines]
                    firstLine.replace(from.ch, firstLine.text.length, newText[0])
                    for (var i = 1, e = newText.length - 1; i < e; ++i) {
                        spliceargs.push(new Line(newText[i]))
                    }
                    spliceargs.push(lastLine)
                    lines.splice.apply(lines, spliceargs)
                }
            } else if (newText.length == 1) {
                firstLine.replace(from.ch, firstLine.text.length, newText[0] + lastLine.text.slice(to.ch))
                lines.splice(from.line + 1, nlines)
            } else {
                var spliceargs = [from.line + 1, nlines - 1]
                firstLine.replace(from.ch, firstLine.text.length, newText[0])
                lastLine.replace(0, to.ch, newText[newText.length - 1])
                for (var i = 1, e = newText.length - 1; i < e; ++i) {
                    spliceargs.push(new Line(newText[i]))
                }
                lines.splice.apply(lines, spliceargs)
            }

            // Add these lines to the work array, so that they will be
            // highlighted. Adjust work lines if lines were added/removed.
            var newWork = []
            var lendiff = newText.length - nlines - 1
            for (var i = 0, l = work.length; i < l; ++i) {
                var task = work[i]
                if (task < from.line) {
                    newWork.push(task)
                } else if (task > to.line) {
                    newWork.push(task + lendiff)
                }
            }
            if (newText.length) {
                newWork.push(from.line)
            }
            work = newWork
            startWorker(100)
            // Remember that these lines changed, for updating the display
            changes.push({ from: from.line, to: to.line + 1, diff: lendiff })
            textChanged = true

            // Update the selection
            function updateLine(n) {
                return n <= Math.min(to.line, to.line + lendiff) ? n : n + lendiff
            }
            setSelection(selFrom, selTo, updateLine(sel.from.line), updateLine(sel.to.line));

            // Make sure the scroll-size div has the correct height.
            code.style.height = (lines.length * lineHeight() + 2 * paddingTop()) + 'px'
        }
        const startState = (mode, a1, a2) => mode.startState ? mode.startState(a1, a2) : true
        const charX = (line, pos) => {
            var text = lines[line].text
            var span = measure.firstChild
            if (text.lastIndexOf("\t", pos) == -1) {
                return pos * charWidth()
            }
            var old = span.firstChild.nodeValue
            try {
                span.firstChild.nodeValue = text.slice(0, pos)
                return span.offsetWidth
            } finally {
                span.firstChild.nodeValue = old
            }
        }
        const handleEnter = () => replaceSelection("\n", 'end')
        const handleTab = shift => {
            shiftSelecting = null
            switch (options.tabMode) {
                case 'default':
                    return false
                case 'indent':
                    for (var i = sel.from.line, e = sel.to.line; i <= e; ++i) {
                        indentLine(i, 'smart')
                    }
                    break
                case 'classic':
                    if (posEq(sel.from, sel.to)) {
                        if (shift) {
                            indentLine(sel.from.line, 'smart')
                        } else {
                            replaceSelection("\t", 'end')
                        }
                        break
                    }
                case 'shift':
                    for (var i = sel.from.line, e = sel.to.line; i <= e; ++i) {
                        indentLine(i, shift ? 'subtract' : 'add')
                    }
                    break
            }
            return true
        }
        const selectWordAt = pos => {
            var line = lines[pos.line].text
            var start = pos.ch
            var end = pos.ch
            while (start > 0 && /\w/.test(line.charAt(start - 1))) {
                --start
            }
            while (end < line.length - 1 && /\w/.test(line.charAt(end))) {
                ++end
            }
            setSelection({ line: pos.line, ch: start }, { line: pos.line, ch: end })
        }

        //#endregion


        //#region Preparing Instance
        this.getValue = getValue
        this.setValue = operation(setValue)
        this.getSelection = getSelection
        this.replaceSelection = operation(replaceSelection)
        this.focus = () => {
            input.focus()
            onFocus()
            fastPoll()
        }
        this.setOption = (option, value) => {
            options[option] = value
            if (option == 'lineNumbers' || option == 'gutter') {
                gutterChanged()
            } else if (option == 'mode' || option == 'indentUnit') {
                loadMode()
            }
        }
        this.getOption = option => options[option]
        this.undo = operation(undo)
        this.redo = operation(redo)
        this.historySize = () => ({ undo: history.done.length, redo: history.undone.length })
        this.getTokenAt = pos => {
            pos = clipPos(pos)
            return lines[pos.line].getTokenAt(mode, getStateBefore(pos.line), pos.ch)
        }
        this.cursorCoords = start => {
            if (start == null) {
                start = sel.inverted
            }
            return pageCoords(start ? sel.from : sel.to)
        }
        this.charCoords = pos => pageCoords(clipPos(pos))
        this.coordsChar = coords => {
            var line = Math.min(showingTo - 1, showingFrom + Math.floor(coords.y / lineHeight()))
            return clipPos({ line: line, ch: charFromX(clipLine(line), coords.x) })
        }
        this.getSearchCursor = (query, pos, caseFold) => new SearchCursor(query, pos, caseFold)
        this.markText = operation((a, b, c) => operation(markText(a, b, c)))
        this.setMarker = addGutterMarker
        this.clearMarker = removeGutterMarker
        this.setLineClass = operation(setLineClass)
        this.lineInfo = lineInfo
        this.addWidget = (pos, node, scroll) => {
            var pos = localCoords(clipPos(pos), true)
            node.style.top = (showingFrom * lineHeight() + pos.yBot + paddingTop()) + 'px'
            node.style.left = (pos.x + paddingLeft()) + 'px'
            code.appendChild(node)
            if (scroll) {
                scrollIntoView(pos.x, pos.yBot, pos.x + node.offsetWidth, pos.yBot + node.offsetHeight)
            }
        }
        this.lineCount = () => lines.length
        this.getCursor = start => {
            if (start == null) start = sel.inverted
            return copyPos(start ? sel.from : sel.to)
        }
        this.somethingSelected = () => !posEq(sel.from, sel.to)
        this.setCursor = operation((line, ch) => {
            if (ch == null && typeof line.line == 'number') {
                setCursor(line.line, line.ch)
            } else {
                setCursor(line, ch)
            }
        })
        this.setSelection = operation((from, to) => setSelection(clipPos(from), clipPos(to || from)))
        this.getLine = line => {
            if (isLine(line)) {
                return lines[line].text
            }
        }
        this.setLine = operation((line, text) => {
            if (isLine(line)) {
                replaceRange(text, { line: line, ch: 0 }, { line: line, ch: lines[line].text.length })
            }
        })
        this.removeLine = operation(line => {
            if (isLine(line)) {
                replaceRange('', { line: line, ch: 0 }, clipPos({ line: line + 1, ch: 0 }))
            }
        })
        this.replaceRange = operation(replaceRange)
        this.getRange = (from, to) => getRange(clipPos(from), clipPos(to))
        this.operation = f => operation(f)()
        this.refresh = () => updateDisplay(true)
        this.getInputField = () => input
        this.getWrapperElement = () => wrapper
        //#endregion

        //#region Prepoare Events
        setTimeout(prepareInput, 20)
        // Register our event handlers.
        connect(wrapper, 'mousedown', operation(onMouseDown))
        // Gecko browsers fire contextmenu *after* opening the menu, at
        // which point we can't mess with it anymore. Context menu is
        // handled in onMouseDown for Gecko.
        if (!gecko) connect(wrapper, 'contextmenu', operation(onContextMenu))
        connect(code, 'dblclick', operation(onDblClick))
        connect(wrapper, 'scroll', () => {
            updateDisplay([])
            if (options.onScroll) {
                options.onScroll(instance)
            }
        })
        connect(window, 'resize', () => updateDisplay(true))
        connect(input, 'keyup', operation(onKeyUp))
        connect(input, 'keydown', operation(onKeyDown))
        connect(input, 'keypress', operation(onKeyPress))
        connect(input, 'focus', onFocus)
        connect(input, 'blur', onBlur)
        connect(wrapper, 'dragenter', e => e.stop())
        connect(wrapper, 'dragover', e => e.stop())
        connect(wrapper, 'drop', operation(onDrop))
        connect(wrapper, 'paste', () => {
            input.focus()
            fastPoll()
        })
        connect(input, 'paste', () => fastPoll())
        connect(input, 'cut', () => fastPoll())
        //#endregion


    }
}