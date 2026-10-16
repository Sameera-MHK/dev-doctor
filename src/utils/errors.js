/** An expected error caused by bad input or environment; shown without a stack trace. */
export class DevDoctorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DevDoctorError';
  }
}

export class UtilityMissingError extends Error {
  constructor(utility) {
    super(`Required system utility "${utility}" was not found`);
    this.name = 'UtilityMissingError';
    this.utility = utility;
  }
}
