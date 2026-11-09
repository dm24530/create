export class ImageSubmissionUnconfirmed extends Error {
  constructor(message = '图片任务提交状态暂无法确认，正在等待网络恢复') {
    super(message)
    this.name = 'ImageSubmissionUnconfirmed'
  }
}
