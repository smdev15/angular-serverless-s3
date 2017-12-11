import * as gulp from 'gulp';
import * as util from 'gulp-util';

import { argv } from 'yargs';
import Config from '../../config';

const AWS = require('aws-sdk');
const awspublish = require('gulp-awspublish');
const merge = require('merge-stream');
const parallelize = require('concurrent-transform');
const invalidate = require('gulp-cloudfront-invalidate-aws-publish');

const distPath = Config.PROD_DEST;

export = () => {
  let errMsg = '';
  let PTC: any;

  const AWS_STAGE = argv['awspublish-stage'];

  if (!AWS_STAGE) {
    errMsg = `\n* Must define awspublish-stage`;
  }

  if (!Config.PUBLISH_TASK_CONFIG || !Config.PUBLISH_TASK_CONFIG[AWS_STAGE]) {
    errMsg += `\n* Missing PUBLISH_TASK_CONFIG.${AWS_STAGE} entry in project.config.ts`;
  }
  PTC = Config.PUBLISH_TASK_CONFIG[AWS_STAGE];

  ['s3', 'cf'].forEach((idx: string) => {
    if (!PTC[idx]) {
      errMsg += `\n* Missing PUBLISH_TASK_CONFIG.${AWS_STAGE}.${idx} entry in project.config.ts`;
    }
  });

  if (!PTC.cf.distribution || !PTC.cf.distribution.trim()) {
    errMsg += `\n* Missing PUBLISH_TASK_CONFIG.${AWS_STAGE}.s3.distribution value in project.config.ts`;
  }

  if (errMsg) {
    util.log(util.colors.red(errMsg));
    throw new Error(errMsg);
  }

  //Load PUBLISH_TASK_CONFIG.awsProfile if not already set in ENV or explicitly set in SDK options
  if (!process.env.AWS_PROFILE && !!PTC.awsProfile && !PTC.s3.credentials) {
    PTC.s3.credentials = new AWS.SharedIniFileCredentials({profile: PTC.awsProfile});
  }
  if (!process.env.AWS_PROFILE && !!PTC.awsProfile && !PTC.cf.credentials) {
    PTC.cf.credentials = new AWS.SharedIniFileCredentials({profile: PTC.awsProfile});
  }

  const s3PublishConfig = PTC.s3;
  const patternsToGzip = (PTC.patternsToGzip && PTC.patternsToGzip.length) ? PTC.patternsToGzip : getDefaultGzipPatterns();
  const gzipPatterns = patternsToGzip.map((p: string) => `${distPath}/${p}`);
  const omitPatterns = (PTC.patternsToOmit && PTC.patternsToOmit.length) ? PTC.patternsToOmit : gzipPatterns;
  const plainPatterns = omitPatterns.map((p: string) => '!' + p).concat(`${distPath}/**/*`);
  const publisher = awspublish.create(s3PublishConfig);

  let headers = getDefaultS3Headers();
  if (PTC.headers && PTC.headers) {
    headers = PTC.headers;
  }

  const gzip = gulp.src(gzipPatterns).pipe(awspublish.gzip());
  const plain = gulp.src(plainPatterns);

  util.log('Publishing', util.colors.yellow(distPath));
  return merge(gzip, plain)
    .pipe(parallelize(publisher.publish(headers), 10))
    .pipe(invalidate(PTC.cf))
    .pipe(awspublish.reporter());
};

function getDefaultGzipPatterns() {
  return ['**/*.js', '**/*.css', '**/*.html'];
}

function getDefaultS3Headers() {
  return {
    'Cache-Control': 'max-age=315360000, no-transform, public'
  };
}
