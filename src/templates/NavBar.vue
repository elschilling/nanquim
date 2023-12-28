<template lang="pug">
section.web-section
  .icon.icon-blender-logo
  ul
    li
      a(href="#") File
    li
      a(href="#") Preferences
    li
      a(href="#") Help
</template>

<style lang="sass" scoped>
.web-section
  display: flex
  align-items: center
  a:link
    text-decoration: none
  border-bottom: var(--editor-border-width) solid var(--editor-border-color)
  background: var(--editor-border-color)
</style>
