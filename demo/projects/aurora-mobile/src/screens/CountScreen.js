import { View, Text } from "react-native";

export default function CountScreen({ route }) {
  return (
    <View style={{ padding: 16 }}>
      <Text>Counting {route.params?.code}</Text>
      <Text>TODO: quantity input and submit to POST /counts</Text>
    </View>
  );
}
