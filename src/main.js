import { createApp } from 'vue'
import './styles/main.sass'
import App from './App.vue'

let app = createApp(App)
// app.config.globalProperties.$commands = commands

app.mount('#app')
