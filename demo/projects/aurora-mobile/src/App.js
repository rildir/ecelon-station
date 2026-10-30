import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ScanScreen from "./screens/ScanScreen.js";
import CountScreen from "./screens/CountScreen.js";

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Scan" component={ScanScreen} />
        <Stack.Screen name="Count" component={CountScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
