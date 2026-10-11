module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Reanimated 4: its worklets plugin must be last.
    plugins: ["react-native-worklets/plugin"],
  };
};
