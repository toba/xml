import { Stream } from 'stream';
import { Encoding, is } from '@toba/tools';

export enum Indent {
   None,
   Space,
   Tab
}

export enum Standalone {
   Yes = 'yes',
   No = 'no'
}

export interface Declaration {
   encoding: Encoding;
   standalone?: Standalone;
}

export interface Options {
   indent: Indent;
   indentSpaces: number;
   /** Add default xml declaration as first node. */
   declaration?: Declaration;
   /** Optionall supply an existing stream to write to */
   stream?: boolean;
}

type Appender = (interrupt: boolean, out?: string) => void;

export interface xmlJSON {
   /**
    * @example
    * xml({a: [{ _attr: { attributes: 'are fun', too: '!' }}, 1]})
    * === <a attributes="are fun" too="!">1</a>
    */
   _attr?: { [key: string]: string };
   /**
    * Value of _cdata is wrapped in xml ![CDATA[]] so the data does not need
    * to be escaped.
    * @example
    * xml({a: { _cdata: "i'm not escaped: <xml>!"}})
    * === <a><![CDATA[i\'m not escaped: <xml>!]]></a>
    */
   _cdata?: string;
   [key: string]: string | number | xmlJSON[];
}

export interface Attribute extends Declaration {
   version: string;
}

export interface Parsed {
   name: string;
   interrupt: boolean;
   attributes: string[];
   content: string[];
   icount: number;
   indents: number;
   indent: boolean;
}

export const xmlEscape: { [key: string]: string } = {
   '&': '&amp;',
   '"': '&quot;',
   "'": '&apos;',
   '<': '&lt;',
   '>': '&gt;'
};

export function escapeForXML(text: string) {
   return text && text.replace
      ? text.replace(/([&"<>'])/g, function(str, item) {
           return xmlEscape[item];
        })
      : text;
}

/**
 * Generate XML from specially formatted JSON
 * @example xml({nested: [{ keys: [{ fun: 'hi' }]}]})
 * === <nested><keys><fun>hi</fun></keys></nested>
 */
export function xml(input: xmlJSON, options: Options) {
   const stream = options.stream ? new Stream.Readable() : null;
   let output = '';
   let interrupted = false;
   let instant = true;
   let indent = '';

   switch (options.indent) {
      case Indent.Space:
         indent = '    ';
         break;
      case Indent.Tab:
         indent = '\t';
         break;
   }

   const delay = (fn: () => void) => {
      if (!instant) {
         fn();
      } else {
         process.nextTick(fn);
      }
   };

   const append = (interrupt: boolean, out?: string) => {
      if (out !== undefined) {
         output += out;
      }

      if (interrupt && !interrupted) {
         interrupted = true;
      }

      if (interrupt && interrupted) {
         let data = output;

         delay(() => {
            stream.emit('data', data);
         });

         output = '';
      }
   };

   const add = (value: any, last?: () => void) => {
      format(append, resolve(value, indent, indent ? 1 : 0), last);
   };

   const end = () => {
      if (stream !== null) {
         let data = output;
         delay(() => {
            stream.emit('data', data);
            stream.emit('end');
            stream.readable = false;
            stream.emit('close');
         });
      }
   };

   const addDeclaration = (declaration: Declaration) => {
      const encoding = declaration.encoding || Encoding.UTF8;
      const attr: Attribute = { version: '1.0', encoding };

      if (declaration.standalone) {
         attr.standalone = declaration.standalone;
      }

      add({ '?xml': { _attr: attr } });
      output = output.replace('/>', '?>');
   };

   // disable delay delayed
   delay(() => {
      instant = false;
   });

   if (options.declaration) {
      addDeclaration(options.declaration);
   }

   if (input && is.array(input)) {
      input.forEach((value, i) => {
         var last;
         if (i + 1 === input.length) {
            last = end;
         }
         add(value, last);
      });
   } else {
      add(input, end);
   }

   if (stream) {
      stream.readable = true;
      return stream;
   }
   return output;
}

function createIndent(character: string = '', count: number = 0) {
   return new Array(count).join(character);
}

function resolve(data: any, indent: string, indentCount: number = 0): Parsed {
   const indentSpaces = createIndent(indent, indentCount);
   const attributes: string[] = [];
   const content: string[] = [];
   let name: string;
   let values = data;
   let interrupt = false;

   if (typeof data === is.Type.Object) {
      const keys = Object.keys(data);
      name = keys[0];
      values = data[name];

      if (values && values._elem) {
         values._elem.name = name;
         values._elem.icount = indentCount;
         values._elem.indent = indent;
         values._elem.indents = indentSpaces;
         values._elem.interrupt = values;
         return values._elem;
      }
   }

   let isStringContent;

   function getAttributes(obj: { [key: string]: string }) {
      var keys = Object.keys(obj);
      keys.forEach(function(key) {
         attributes.push(attribute(key, obj[key]));
      });
   }

   switch (typeof values) {
      case is.Type.Object:
         if (values === null) {
            break;
         }

         if (values._attr) {
            getAttributes(values._attr);
         }

         if (values._cdata) {
            content.push(
               ('<![CDATA[' + values._cdata).replace(
                  /\]\]>/g,
                  ']]]]><![CDATA[>'
               ) + ']]>'
            );
         }

         if (is.array(values)) {
            isStringContent = false;
            content.push('');
            values.forEach(function(value) {
               if (typeof value == 'object') {
                  var _name = Object.keys(value)[0];

                  if (_name == '_attr') {
                     getAttributes(value._attr);
                  } else {
                     content.push(resolve(value, indent, indentCount + 1));
                  }
               } else {
                  //string
                  content.pop();
                  isStringContent = true;
                  content.push(escapeForXML(value));
               }
            });
            if (!isStringContent) {
               content.push('');
            }
         }
         break;

      default:
         //string
         content.push(escapeForXML(values));
   }

   return {
      name: name,
      interrupt: interrupt,
      attributes: attributes,
      content: content,
      icount: indentCount,
      indents: indentSpaces,
      indent: indent
   };
}

function format(append: Appender, elem: any, end?: () => void) {
   if (typeof elem != is.Type.Object) {
      return append(false, elem);
   }

   var len = elem.interrupt ? 1 : elem.content.length;

   function proceed() {
      while (elem.content.length) {
         var value = elem.content.shift();

         if (value === undefined) continue;
         if (interrupt(value)) return;

         format(append, value);
      }

      append(
         false,
         (len > 1 ? elem.indents : '') +
            (elem.name ? '</' + elem.name + '>' : '') +
            (elem.indent && !end ? '\n' : '')
      );

      if (end) {
         end();
      }
   }

   function interrupt(value) {
      if (value.interrupt) {
         value.interrupt.append = append;
         value.interrupt.end = proceed;
         value.interrupt = false;
         append(true);
         return true;
      }
      return false;
   }

   append(
      false,
      elem.indents +
         (elem.name ? '<' + elem.name : '') +
         (elem.attributes.length ? ' ' + elem.attributes.join(' ') : '') +
         (len ? (elem.name ? '>' : '') : elem.name ? '/>' : '') +
         (elem.indent && len > 1 ? '\n' : '')
   );

   if (!len) {
      return append(false, elem.indent ? '\n' : '');
   }

   if (!interrupt(elem)) {
      proceed();
   }
}

const attribute = (key: string, value: string) =>
   `${key}="${escapeForXML(value)}`;
