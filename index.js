/**
 * @format
 */
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { runAndroidWorkerTask } from './src/androidWorkerRuntime';

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask('PocketMindWorker', () => runAndroidWorkerTask);
