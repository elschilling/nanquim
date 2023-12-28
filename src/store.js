import { reactive } from 'vue'

export const store = reactive({
  isDrawing: false,
  hoverThreshold: 10,
  hoverStyle: 'orange',
  hoverLineWidth: 3,
  drawStyle: 'white',
  drawLineWidth: 1,
})
