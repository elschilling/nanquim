<template lang="pug">
section.web-section
  ul
    li
      | ({{ coords.x }}, {{ coords.y }} )
    li
      | svgcad 0.0.0
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({ coords: Object })
</script>

<style lang="sass" scoped>
.web-section
  background: var(--editor-border-color)
  border-top: var(--editor-border-width) solid var(--editor-border-color)
  display: flex
  justify-content: right
</style>
