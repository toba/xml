function element(/*input, …*/) {
   var input = Array.prototype.slice.call(arguments),
      self = {
         _elem: resolve(input)
      };

   self.push = function(input) {
      if (!this.append) {
         throw new Error('not assigned to a parent!');
      }
      var that = this;
      var indent = this._elem.indent;
      format(
         this.append,
         resolve(input, indent, this._elem.icount + (indent ? 1 : 0)),
         function() {
            that.append(true);
         }
      );
   };

   self.close = function(input) {
      if (input !== undefined) {
         this.push(input);
      }
      if (this.end) {
         this.end();
      }
   };

   return self;
}
