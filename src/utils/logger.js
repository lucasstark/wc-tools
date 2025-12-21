import chalk from 'chalk';
import ora from 'ora';

export const logger = {
  success(message) {
    console.log(chalk.green('✔'), message);
  },

  error(message) {
    console.error(chalk.red('✖'), message);
  },

  info(message) {
    console.log(chalk.blue('ℹ'), message);
  },

  warn(message) {
    console.log(chalk.yellow('⚠'), message);
  },

  step(message) {
    console.log(chalk.cyan('→'), message);
  },

  spinner(text) {
    return ora({
      text,
      color: 'cyan'
    }).start();
  }
};
