/* Copyright (c) 2012-2022 The ANTLR Project. All rights reserved.
 * Use of this file is governed by the BSD 3-clause license that
 * can be found in the LICENSE.txt file in the project root.
 */

import Token from './Token.js';
import Recognizer from './Recognizer.js';
import CommonTokenFactory from './CommonTokenFactory.js';
import RecognitionException from './error/RecognitionException.js';
import LexerNoViableAltException from './error/LexerNoViableAltException.js';

/**
 * A lexer is recognizer that draws input symbols from a character stream.
 * lexer grammars result in a subclass of this object. A Lexer object
 * uses simplified match() and error recovery mechanisms in the interest of speed.
 */
export default class Lexer extends Recognizer {
	constructor(input) {
		super();
		this._input = input;
		this._factory = CommonTokenFactory.DEFAULT;
		this._tokenFactorySourcePair = [ this, input ];

		this._interp = null; // child classes must populate this

		/**
		 * The goal of all lexer rules/methods is to create a token object.
		 * this is an instance variable as multiple rules may collaborate to
		 * create a single token. nextToken will return this object after
		 * matching lexer rule(s). If you subclass to allow multiple token
		 * emissions, then set this to the last token to be matched or
		 * something nonnull so that the auto token emit mechanism will not
		 * emit another token.
		 */
		this._token = null;

		/**
		 * What character index in the stream did the current token start at?
		 * Needed, for example, to get the text for current token. Set at
		 * the start of nextToken.
		 */
		this._tokenStartCharIndex = -1;

		// The line on which the first character of the token resides///
		this._tokenStartLine = -1;

		// The character position of first character within the line///
		this._tokenStartColumn = -1;

		// Once we see EOF on char stream, next token will be EOF.
		// If you have DONE : EOF ; then you see DONE EOF.
		this._hitEOF = false;

		// The channel number for the current token///
		this._channel = Token.DEFAULT_CHANNEL;

		// The token type for the current token///
		this._type = Token.INVALID_TYPE;

		this._modeStack = [];
		this._mode = Lexer.DEFAULT_MODE;

		/**
		 * You can set the text for the current token to override what is in
		 * the input char buffer. Use setText() or can set this instance var.
		 */
		this._text = null;
	}

	reset() {
		// wack Lexer state variables
		if (this._input !== null) {
			this._input.seek(0); // rewind the input
		}
		this._token = null;
		this._type = Token.INVALID_TYPE;
		this._channel = Token.DEFAULT_CHANNEL;
		this._tokenStartCharIndex = -1;
		this._tokenStartColumn = -1;
		this._tokenStartLine = -1;
		this._text = null;

		this._hitEOF = false;
		this._mode = Lexer.DEFAULT_MODE;
		this._modeStack = [];

		this._interp.reset();
	}

// Return a token from this source; i.e., match a token on the char stream.
	nextToken() {
		if (this._input === null) {
			throw "nextToken requires a non-null input stream.";
		}

		/**
		 * Mark start location in char stream so unbuffered streams are
		 * guaranteed at least have text of current token
		 */
		const tokenStartMarker = this._input.mark();
		try {
			for (;;) {
				if (this._hitEOF) {
					this.emitEOF();
					return this._token;
				}
				this._token = null;
				this._channel = Token.DEFAULT_CHANNEL;
				this._tokenStartCharIndex = this._input.index;
				this._tokenStartColumn = this._interp.column;
				this._tokenStartLine = this._interp.line;
				this._text = null;
				let continueOuter = false;
				for (;;) {
					this._type = Token.INVALID_TYPE;
					let ttype = Lexer.SKIP;
					try {
						ttype = this._interp.match(this._input, this._mode);
					} catch (e) {
						if(e instanceof RecognitionException) {
							this.notifyListeners(e); // report error
							this.recover(e);
						} else {
                            console.log(e.stack);
							throw e;
						}
					}
					if (this._input.LA(1) === Token.EOF) {
						this._hitEOF = true;
					}
					if (this._type === Token.INVALID_TYPE) {
						this._type = ttype;
					}
					if (this._type === Lexer.SKIP) {
						continueOuter = true;
						break;
					}
					if (this._type !== Lexer.MORE) {
						break;
					}
				}
				if (continueOuter) {
					continue;
				}
				if (this._token === null) {
					this.emit();
				}
				return this._token;
			}
		} finally {
			// make sure we release marker after match or
			// unbuffered char stream will keep buffering
			this._input.release(tokenStartMarker);
		}
	}

	/**
	 * Instruct the lexer to skip creating a token for current lexer rule
	 * and look for another token. nextToken() knows to keep looking when
	 * a lexer rule finishes with token set to SKIP_TOKEN. Recall that
	 * if token==null at end of any token rule, it creates one for you
	 * and emits it.
	 */
	skip() {
		this._type = Lexer.SKIP;
	}

	more() {
		this._type = Lexer.MORE;
	}

	mode(m) {
		this._mode = m;
	}

	pushMode(m) {
		if (this._interp.debug) {
			console.log("pushMode " + m);
		}
		this._modeStack.push(this._mode);
		this.mode(m);
	}

	popMode() {
		if (this._modeStack.length === 0) {
			throw "Empty Stack";
		}
		if (this._interp.debug) {
			console.log("popMode back to " + this._modeStack.slice(0, -1));
		}
		this.mode(this._modeStack.pop());
		return this._mode;
	}

	/**
	 * By default does not support multiple emits per nextToken invocation
	 * for efficiency reasons. Subclass and override this method, nextToken,
	 * and getToken (to push tokens into a list and pull from that list
	 * rather than a single variable as this implementation does).
	 */
	emitToken(token) {
		this._token = token;
	}

	/**
	 * The standard method called to automatically emit a token at the
	 * outermost lexical rule. The token object should point into the
	 * char buffer start..stop. If there is a text override in 'text',
	 * use that to set the token's text. Override this method to emit
	 * custom Token objects or provide a new factory.
	 */
	emit() {
		const t = this._factory.create(this._tokenFactorySourcePair, this._type,
				this._text, this._channel, this._tokenStartCharIndex, this
						.getCharIndex() - 1, this._tokenStartLine,
				this._tokenStartColumn);
		this.emitToken(t);
		return t;
	}

	emitEOF() {
		const cpos = this.column;
		const lpos = this.line;
		const eof = this._factory.create(this._tokenFactorySourcePair, Token.EOF,
				null, Token.DEFAULT_CHANNEL, this._input.index,
				this._input.index - 1, lpos, cpos);
		this.emitToken(eof);
		return eof;
	}

// What is the index of the current character of lookahead?///
	getCharIndex() {
		return this._input.index;
	}

	/**
	 * Return a list of all Token objects in input char stream.
	 * Forces load of all tokens. Does not include EOF token.
	 */
	getAllTokens() {
		const tokens = [];
		let t = this.nextToken();
		while (t.type !== Token.EOF) {
			tokens.push(t);
			t = this.nextToken();
		}
		return tokens;
	}

	notifyListeners(e) {
		const start = this._tokenStartCharIndex;
		const stop = this._input.index;
		const text = this._input.getText(start, stop);
		const msg = "token recognition error at: '" + this.getErrorDisplay(text) + "'";
		const listener = this.getErrorListenerDispatch();
		listener.syntaxError(this, null, this._tokenStartLine,
				this._tokenStartColumn, msg, e);
	}

	getErrorDisplay(s) {
		const d = [];
		for (let i = 0; i < s.length; i++) {
			d.push(s[i]);
		}
		return d.join('');
	}

	getErrorDisplayForChar(c) {
		if (c.charCodeAt(0) === Token.EOF) {
			return "<EOF>";
		} else if (c === '\n') {
			return "\\n";
		} else if (c === '\t') {
			return "\\t";
		} else if (c === '\r') {
			return "\\r";
		} else {
			return c;
		}
	}

	getCharErrorDisplay(c) {
		return "'" + this.getErrorDisplayForChar(c) + "'";
	}

	/**
	 * Lexers can normally match any char in it's vocabulary after matching
	 * a token, so do the easy thing and just kill a character and hope
	 * it all works out. You can instead use the rule invocation stack
	 * to do sophisticated error recovery if you are in a fragment rule.
	 */
	recover(re) {
		if (this._input.LA(1) !== Token.EOF) {
			if (re instanceof LexerNoViableAltException) {
				// skip a char and try again
				this._interp.consume(this._input);
			} else {
				// TODO: Do we lose character or line position information?
				this._input.consume();
			}
		}
	}

	get inputStream(){
		return this._input;
	}

	set inputStream(input) {
		this._input = null;
		this._tokenFactorySourcePair = [ this, this._input ];
		this.reset();
		this._input = input;
		this._tokenFactorySourcePair = [ this, this._input ];
	}

	get sourceName(){
		return this._input.sourceName;
	}

	get type(){
		return this._type;
	}

	set type(type) {
		this._type = type;
	}

	get line(){
		return this._interp.line;
	}

	set line(line) {
		this._interp.line = line;
	}

	get column(){
		return this._interp.column;
	}

	set column(column) {
		this._interp.column = column;
	}

	get text(){
		if (this._text !== null) {
			return this._text;
		} else {
			return this._interp.getText(this._input);
		}
	}

	set text(text) {
		this._text = text;
	}
}




Lexer.DEFAULT_MODE = 0;
Lexer.MORE = -2;
Lexer.SKIP = -3;

Lexer.DEFAULT_TOKEN_CHANNEL = Token.DEFAULT_CHANNEL;
Lexer.HIDDEN = Token.HIDDEN_CHANNEL;
Lexer.MIN_CHAR_VALUE = 0x0000;
Lexer.MAX_CHAR_VALUE = 0x10FFFF;

