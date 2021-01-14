import {Command, flags} from '@oclif/command'
import {ArchTypes, PlatformTypes} from '@oclif/config'
import * as qq from 'qqjs'

import aws from '../../aws'
import {log} from '../../log'
import * as Tarballs from '../../tarballs'
import {commitAWSDir, commitSHA, s3Key} from '../../upload-util'

export default class Upload extends Command {
  static hidden = true

  static description = `upload an oclif CLI to S3

"aws-sdk" will need to be installed as a devDependency to upload.
`

  static flags = {
    root: flags.string({char: 'r', description: 'path to oclif CLI root', default: '.', required: true}),
    targets: flags.string({char: 't', description: 'comma-separated targets to pack (e.g.: linux-arm,win32-x64)'}),
  }

  buildConfig!: Tarballs.IConfig

  async run() {
    const {flags} = this.parse(Upload)
    if (process.platform === 'win32') throw new Error('upload does not function on windows')
    const targetOpts = flags.targets ? flags.targets.split(',') : undefined
    this.buildConfig = await Tarballs.buildConfig(flags.root, {targets: targetOpts})
    const {s3Config, targets, dist, version, config} = this.buildConfig
    if (!await qq.exists(dist(s3Key('unversioned', {ext: '.tar.gz'})))) this.error('run "oclif-dev pack" before uploading')
    const S3Options = {
      Bucket: s3Config.bucket!,
      ACL: s3Config.acl || 'public-read',
    }

    const uploadTarball = async (options?: {platform: PlatformTypes; arch: ArchTypes}) => {
      const TarballS3Options = {...S3Options, CacheControl: 'max-age=604800'}
      const releaseTarballs = async (ext: '.tar.gz' | '.tar.xz') => {
        const localKey = s3Key('unversioned', ext, {
          arch: options?.arch!,
          bin: config.bin,
          platform: options?.platform!,
          root: config.root,
        })
        const cloudKey = `${commitAWSDir(version, config.root)}/${localKey}`
        await aws.s3.uploadFile(dist(localKey), {...TarballS3Options, ContentType: 'application/gzip', Key: cloudKey})
      }

      await releaseTarballs('.tar.gz')
      if (this.buildConfig.xz) await releaseTarballs('.tar.xz')

      const ManifestS3Options = {...S3Options, CacheControl: 'max-age=86400', ContentType: 'application/json'}
      const s3ManifestKey = (): string => {
        const s3Root = commitAWSDir(version, config.root)
        const manifest = s3Key('manifest', options)
        return `${s3Root}/${manifest}`
      }
      const manifest = s3ManifestKey()
      await aws.s3.uploadFile(dist(manifest), {...ManifestS3Options, Key: manifest})
    }
    if (targets.length > 0) log('uploading targets')
    // eslint-disable-next-line no-await-in-loop
    for (const target of targets) await uploadTarball(target)
    log(`uploaded ${version}, git SHA ${commitSHA(this.config.root)} targets`)
  }
}