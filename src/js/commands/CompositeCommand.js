import { Command } from '../Command.js'

function requireSynchronous(result, operation) {
  if (result && typeof result.then === 'function') {
    throw new TypeError(`Composite child ${operation}() must be synchronous.`)
  }
}

function applyChild(command, isRedo) {
  const operation = isRedo && typeof command.redo === 'function'
    ? command.redo.bind(command)
    : command.execute.bind(command)
  requireSynchronous(operation(), isRedo ? 'redo' : 'execute')
}

function undoChild(command) {
  requireSynchronous(command.undo(), 'undo')
}

function rollbackError(originalError, rollbackErrors) {
  if (rollbackErrors.length === 0) return originalError
  return new AggregateError(
    [originalError, ...rollbackErrors],
    `${originalError.message} Composite rollback also failed.`,
  )
}

class CompositeCommand extends Command {
  constructor(editor, commands, {
    name = 'Composite Edit',
    onApplied = null,
    rollbackAllOnFailure = false,
  } = {}) {
    super(editor)
    this.type = 'CompositeCommand'
    this.name = name
    this.commands = [...commands]
    this.onApplied = onApplied
    this.rollbackAllOnFailure = rollbackAllOnFailure
  }

  execute() {
    this._apply(false)
  }

  redo() {
    this._apply(true)
  }

  undo() {
    this._validate()
    const undone = []
    for (let index = this.commands.length - 1; index >= 0; index -= 1) {
      const command = this.commands[index]
      try {
        undoChild(command)
        undone.push(command)
      } catch (error) {
        const rollbackErrors = []
        try {
          applyChild(command, true)
        } catch (rollbackFailure) {
          rollbackErrors.push(rollbackFailure)
        }
        for (const undoneCommand of undone.reverse()) {
          try {
            applyChild(undoneCommand, true)
          } catch (rollbackFailure) {
            rollbackErrors.push(rollbackFailure)
          }
        }
        throw rollbackError(error, rollbackErrors)
      }
    }

    try {
      this._afterApplied('undo')
    } catch (error) {
      const rollbackErrors = []
      for (const command of this.commands) {
        try {
          applyChild(command, true)
        } catch (rollbackFailure) {
          rollbackErrors.push(rollbackFailure)
        }
      }
      throw rollbackError(error, rollbackErrors)
    }
  }

  _apply(isRedo) {
    this._validate()
    const applied = []
    for (const command of this.commands) {
      try {
        applyChild(command, isRedo)
        applied.push(command)
      } catch (error) {
        const rollbackErrors = []
        const rollbackCommands = this.rollbackAllOnFailure
          ? [...this.commands].reverse()
          : [command, ...[...applied].reverse()]
        for (const rollbackCommand of rollbackCommands) {
          try {
            undoChild(rollbackCommand)
          } catch (rollbackFailure) {
            rollbackErrors.push(rollbackFailure)
          }
        }
        throw rollbackError(error, rollbackErrors)
      }
    }

    try {
      this._afterApplied(isRedo ? 'redo' : 'execute')
    } catch (error) {
      const rollbackErrors = []
      const rollbackCommands = this.rollbackAllOnFailure
        ? [...this.commands].reverse()
        : [...applied].reverse()
      for (const rollbackCommand of rollbackCommands) {
        try {
          undoChild(rollbackCommand)
        } catch (rollbackFailure) {
          rollbackErrors.push(rollbackFailure)
        }
      }
      throw rollbackError(error, rollbackErrors)
    }
  }

  _afterApplied(phase) {
    if (this.onApplied) requireSynchronous(this.onApplied(phase), 'onApplied')
  }

  _validate() {
    if (this.commands.length === 0) {
      throw new TypeError('Composite commands require at least one child command.')
    }
    this.commands.forEach((command) => {
      if (
        !command
        || typeof command.execute !== 'function'
        || typeof command.undo !== 'function'
      ) {
        throw new TypeError('Every composite child must implement execute() and undo().')
      }
    })
  }
}

export { CompositeCommand }
