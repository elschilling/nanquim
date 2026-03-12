import { Command } from '../Command.js';

class RemoveElementCommand extends Command {

	constructor( editor, element ) {

		super( editor );

		this.type = 'RemoveElementCommand';
		this.name = 'Remove Element';
		this.element = element;
		this.parent = ( element !== undefined ) ? element.node.parentNode : undefined;
		// if ( this.parent !== undefined ) {

		// 	this.index = this.parent.children.indexOf( this.element );

		// }

	}

	execute() {

		this.editor.removeElement( this.element );
		// this.editor.deselect();

	}

	undo() {

		this.editor.addElement( this.element, this.parent);
		// this.editor.select( this.object );

	}
}

export { RemoveElementCommand };
