import { Hono } from 'hono'
import * as Controller712 from '../controllers/7-12.controller'

const workerRoutes = new Hono()

// NO MIDDLEWARE on worker routes - raw handling
workerRoutes.post('/7-12/complete', Controller712.complete712Request)

export default workerRoutes