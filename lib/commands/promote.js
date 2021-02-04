"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const command_1 = require("@oclif/command");
const cli_ux_1 = require("cli-ux");
const path = require("path");
const aws_1 = require("../aws");
const Tarballs = require("../tarballs");
const log_1 = require("../log");
const upload_util_1 = require("../upload-util");
class Promote extends command_1.Command {
    async run() {
        const { flags } = this.parse(Promote);
        const targets = flags.targets.split(',');
        const buildConfig = await Tarballs.buildConfig(flags.root, { targets });
        const { s3Config, config } = buildConfig;
        if (!s3Config.bucket)
            this.error('Cannot determine S3 bucket for promotion');
        const cloudBucketCommitKey = (shortKey) => path.join(s3Config.bucket, upload_util_1.commitAWSDir(flags.version, flags.sha, s3Config), shortKey);
        const cloudChannelKey = (shortKey) => path.join(upload_util_1.channelAWSDir(flags.channel, s3Config), shortKey);
        // copy tarballs manifests
        for (const target of buildConfig.targets) {
            const manifest = upload_util_1.templateShortKey('manifest', {
                arch: target.arch,
                bin: config.bin,
                platform: target.platform,
                sha: buildConfig.gitSha,
                version: config.version,
            });
            const copySource = cloudBucketCommitKey(manifest);
            // strip version & sha so update/scripts can point to a static channel manifest
            const unversionedManifest = manifest.replace(`-v${flags.version}-${flags.sha}`, '');
            const key = cloudChannelKey(unversionedManifest);
            log_1.log(`Promoting ${copySource} to ${flags.channel} at s3://${s3Config.bucket}/${key}`);
            // eslint-disable-next-line no-await-in-loop
            await aws_1.default.s3.copyObject({
                Bucket: s3Config.bucket,
                CopySource: copySource,
                Key: key,
            });
        }
        // copy darwin pkg
        if (flags.macos) {
            const darwinPkg = upload_util_1.templateShortKey('macos', { bin: config.bin, version: flags.version, sha: flags.sha });
            const darwinCopySource = cloudBucketCommitKey(darwinPkg);
            // strip version & sha so scripts can point to a static channel pkg
            const unversionedPkg = darwinPkg.replace(`-v${flags.version}-${flags.sha}`, '');
            const darwinKey = cloudChannelKey(unversionedPkg);
            log_1.log(`Promoting ${darwinCopySource} to ${flags.channel} at s3://${s3Config.bucket}/${darwinKey}`);
            await aws_1.default.s3.copyObject({
                Bucket: s3Config.bucket,
                CopySource: darwinCopySource,
                Key: darwinKey,
            });
        }
        // copy win exe
        if (flags.win) {
            const archs = buildConfig.targets.filter(t => t.platform === 'win32').map(t => t.arch);
            for (const arch of archs) {
                const winPkg = upload_util_1.templateShortKey('win32', { bin: config.bin, version: flags.version, sha: flags.sha, arch });
                const winCopySource = cloudBucketCommitKey(winPkg);
                // strip version & sha so scripts can point to a static channel exe
                const unversionedExe = winPkg.replace(`-v${flags.version}-${flags.sha}`, '');
                const winKey = cloudChannelKey(unversionedExe);
                log_1.log(`Promoting ${winCopySource} to ${flags.channel} at s3://${s3Config.bucket}/${winKey}`);
                // eslint-disable-next-line no-await-in-loop
                await aws_1.default.s3.copyObject({
                    Bucket: s3Config.bucket,
                    CopySource: winCopySource,
                    Key: winKey,
                });
                cli_ux_1.cli.action.stop('successfully');
            }
        }
        // copy debian artifacts
        const debArtifacts = [
            upload_util_1.templateShortKey('deb', { bin: config.bin, versionShaRevision: upload_util_1.debVersion(buildConfig), arch: 'amd64' }),
            upload_util_1.templateShortKey('deb', { bin: config.bin, versionShaRevision: upload_util_1.debVersion(buildConfig), arch: 'i386' }),
            'Packages.gz',
            'Packages.xz',
            'Packages.bz2',
            'Release',
            'InRelease',
            'Release.gpg',
        ];
        if (flags.deb) {
            for (const artifact of debArtifacts) {
                const debCopySource = cloudBucketCommitKey(`apt/${artifact}`);
                const debKey = cloudChannelKey(`apt/${artifact}`);
                log_1.log(`Promoting ${debCopySource} to ${flags.channel} at s3://${s3Config.bucket}/${debKey}`);
                // eslint-disable-next-line no-await-in-loop
                await aws_1.default.s3.copyObject({
                    Bucket: s3Config.bucket,
                    CopySource: debCopySource,
                    Key: debKey,
                });
            }
        }
    }
}
exports.default = Promote;
Promote.hidden = true;
Promote.description = 'promote CLI builds to a S3 release channel';
Promote.flags = {
    root: command_1.flags.string({ char: 'r', description: 'path to the oclif CLI project root', default: '.', required: true }),
    version: command_1.flags.string({ description: 'semantic version of the CLI to promote', required: true }),
    sha: command_1.flags.string({ description: '7-digit short git commit SHA of the CLI to promote', required: true }),
    channel: command_1.flags.string({ description: 'which channel to promote to', required: true, default: 'stable' }),
    targets: command_1.flags.string({
        char: 't',
        description: 'comma-separated targets to promote (e.g.: linux-arm,win32-x64)',
        default: Tarballs.TARGETS.join(','),
    }),
    deb: command_1.flags.boolean({ char: 'd', description: 'promote debian artifacts' }),
    macos: command_1.flags.boolean({ char: 'm', description: 'promote MacOS pkg' }),
    win: command_1.flags.boolean({ char: 'w', description: 'promote Windows exe' }),
};