import { useState } from "react";
import { View, Text, TextInput, Button } from "react-native";

export default function ScanScreen({ navigation }) {
  const [code, setCode] = useState("");
  return (
    <View style={{ padding: 16 }}>
      <Text>Scan or type a stock code</Text>
      <TextInput value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="ST-1001" />
      <Button title="Start count" onPress={() => navigation.navigate("Count", { code })} />
    </View>
  );
}
