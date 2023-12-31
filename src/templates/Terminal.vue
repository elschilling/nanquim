<template lang="pug">
.terminal
  .terminal-log(ref='terminalLog')
    p Type a command
  .terminal-input
    | > 
    input(ref='terminalInput' type='text', name='title', v-model='terminalText').terminal-input-field
    span.icon.icon-editor-terminal.align-right

</template>

<script setup>
const props = defineProps({ ctx: Function, coords: Object })

const emit = defineEmits(['inputAsk', 'stopDrawing'])
import { ref, onMounted } from 'vue'
import commands from '../commands/_commands'
import { useEventBus } from '@vueuse/core'
import { store } from '../store'

const terminalInput = ref(null)
const terminalLog = ref(null)
const terminalText = ref(null)
const newTerminalLog = useEventBus('terminalLog')

newTerminalLog.on((e) => {
  const node = document.createElement(e.type)
  node.textContent = e.msg
  terminalLog.value.appendChild(node)
  terminalLog.value.scrollTop = terminalLog.value.scrollHeight
  if (e.inputAsk) {
    emit('inputAsk')
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleInput)
  document.addEventListener('keyup', handleKeyUp)
})

function handleInput(e) {
  terminalInput.value.focus()
}

function handleKeyUp(e) {
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
    const typedCommand = terminalText.value.trim().toLowerCase()

    for (const [command, { execute, aliases }] of Object.entries(commands)) {
      if (aliases.includes(typedCommand)) {
        // Execute the command function
        execute(props.ctx)
        // Clear input after execution
        terminalText.value = ''
        return // Exit the loop after executing the command
      }
    }
    // If no matching command or alias found
    console.log('Command not found')
  }
}
</script>

<style lang="sass" scoped>
.terminal
  z-index: 5
  box-sizing: border-box
  font-size: var(--font-size)
  border-radius: 10px 10px 0 0
  left: 50%
  transform: translate(-50%)
  background: rgba(.2,.2,.2,.9)
  position: absolute
  bottom: 0
  width: 600px
  height: 110px
.terminal-log
  width: 100%
  height: 90px
  box-sizing: border-box
  position: absolute
  top: 0px
  padding: 0px 0px 0px 20px
  overflow: scroll
.terminal-input
  box-sizing: border-box
  border-radius: 5px
  padding: 4px
  display: flex
  align-items: center
  width: 100%
  height: 20px
  position: absolute
  bottom: 0
  background: rgb(10,10,10)
.align-right
  position: absolute
  right: 0
.terminal-input-field
  box-sizing: border-box
  margin-left: 10px
  width: 92%
  color: white
  background: rgba(0,0,0,0)
  border: 0
  outline: none
</style>
