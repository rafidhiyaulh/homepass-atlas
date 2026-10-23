import { randomUUID } from 'node:crypto'
import { apiError, apiMe, HttpError } from '@/lib/auth'
import { rateLimit } from '@/lib/guard'
import { storageAdmin } from '@/lib/admin'
import { LIMITS } from '@/lib/kmz'

// Step 1 of an upload: a one-time signed URL so the browser sends the file straight to private
// Storage (the KMZ never passes through the 4.5 MB serverless request limit).
export async function POST(request: Request) {
  try {
    const me = await apiMe()
    if (me.role === 'viewer') throw new HttpError(403, 'forbidden', 'Viewers cannot upload')
    await rateLimit(me, 'upload', 20, 3600)
    const { filename, size } = await request.json()
    if (typeof filename !== 'string' || !/\.(kmz|kml)$/i.test(filename)) throw new HttpError(400, 'bad_format', 'Only .kmz or .kml')
    if (typeof size !== 'number' || size <= 0 || size > LIMITS.uploadBytes) throw new HttpError(400, 'too_large', 'Max 20 MB')
    const path = `${me.sub}/${randomUUID()}.${filename.toLowerCase().endsWith('.kml') ? 'kml' : 'kmz'}`
    const { data, error } = await storageAdmin().createSignedUploadUrl(path)
    if (error) throw error
    return Response.json({ path, token: data.token })
  } catch (e) {
    return apiError(e)
  }
}
